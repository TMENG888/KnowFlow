import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {config,PLATFORMS} from './config.mjs';
import {BrowserManager,Observer} from './browser.mjs';
import {extractDetail} from './adapters.mjs';
import {deriveTaskState,contentHash,terminalStates} from './domain.mjs';
import {transcribe} from './media.mjs';
import {scoreItems,selectScoringCorpus} from './scoring.mjs';
import {RecoveryMonitor} from './recovery.mjs';
import {startUiSearch,visibleCandidates,clickCandidate,returnToResults,pace,readDetail} from './ui-navigation.mjs';
import {Semaphore} from './scheduler.mjs';
import {collectZhihu} from './zhihu-pipeline.mjs';
import {advanceToutiaoResults} from './toutiao-pagination.mjs';
export class Engine{
 constructor(store){this.store=store;this.browser=new BrowserManager();this.running=null;this.controllers=new Map();this.pendingRecoveries=new Map();this.mediaSlots=new Semaphore(config.mediaConcurrency??1);this.recovery=new RecoveryMonitor(this.browser,store,async(w,reason)=>{
  if(this.running===w.taskId&&this.enqueueRecovery?.(w.platform)){this.log({id:w.taskId},w.platform,'页面恢复，已独立续采该平台');return;}
  this.log({id:w.taskId},w.platform,'检测到页面恢复：'+reason+'；已排队自动续采');const p=this.pendingRecoveries.get(w.taskId)||new Set();p.add(w.platform);this.pendingRecoveries.set(w.taskId,p);this.drainRecoveries();
 });}
 recover(){for(const t of this.store.tasks())if(['running','queued'].includes(t.status)){t.status='interrupted';for(const s of t.stages)if(!terminalStates.includes(s.status)){s.status='interrupted';s.message='上次服务中断，已保存内容；请手动继续';}this.save(t);}}
 save(task){task.updatedAt=new Date().toISOString();this.store.saveTask(task);}
 log(task,platform,message,level='info',extra={}){return this.store.event(task.id,{platform,message,level,...extra});}
 validate(input){
  const keyword=String(input.keyword||'').trim();if(!keyword||keyword.length>200)throw new Error('检索词须为1—200个字符');
  const platforms=[...new Set(input.platforms||[])];if(!platforms.length||platforms.some(p=>!PLATFORMS[p]))throw new Error('请选择有效平台');
  const target=Number(input.target??3);if(!Number.isInteger(target)||target<1||target>100)throw new Error('每平台目标量须为1—100条');
  return{keyword,platforms,target,transcribeVideos:input.transcribeVideos!==false,autoResumeAfterLogin:input.autoResumeAfterLogin!==false,...(input.topicOrigin?{topicOrigin:input.topicOrigin}:{})};
 }
 create(input){
  if(this.running)throw new Error('已有任务正在采集，请等待或先安全停止');
  const v=this.validate(input),task={id:randomUUID(),...v,createdAt:new Date().toISOString(),status:'queued',machine:os.hostname(),stages:v.platforms.map(platform=>({platform,status:'queued',target:v.target,accepted:0,discovered:0,pendingContent:0,failedDetails:0,message:'等待采集'}))};
  this.save(task);this.run(task);return task;
 }
 retry(id,{platforms=null}={}){if(this.running)throw new Error('已有任务运行中');const task=this.store.task(id);if(!task)throw new Error('任务不存在');if(platforms&&(!Array.isArray(platforms)||!platforms.length||platforms.some(p=>!task.platforms.includes(p))))throw new Error('重试平台必须属于原任务');if(platforms)for(const p of platforms)this.recovery.stopPlatform(id,p);else this.recovery.stop(id);task.status='queued';task.stopRequested=false;for(const s of task.stages)if(s.status!=='completed'&&(!platforms||platforms.includes(s.platform))){s.status='queued';s.message='准备从已保存断点继续';}this.save(task);this.run(task,platforms);return task;}
 stop(id){const task=this.store.task(id);if(!task)throw new Error('任务不存在');task.stopRequested=true;if(this.running!==id)task.status='stopped';this.save(task);this.recovery.stop(id);this.pendingRecoveries.delete(id);this.controllers.get(id)?.abort();return task;}
 drainRecoveries(){if(this.running)return;for(const [id,platforms]of this.pendingRecoveries){this.pendingRecoveries.delete(id);const task=this.store.task(id);if(!task||task.stopRequested)continue;for(const p of platforms)this.recovery.stopPlatform(id,p);this.run(task,[...platforms]);break;}}
 scored(id){
  const corpus=selectScoringCorpus(this.store.allItems());
  const scored=scoreItems(corpus,{minSize:config.minCalibrationSize,weights:config.scoreWeights});const byKey=new Map(scored.map(i=>[i.platform+':'+i.sourceId,i.influence]));
  return this.store.items(id).map(i=>({...i,influence:byKey.get(i.platform+':'+i.sourceId)||null}));
 }
 async evidence(page,task,platform,label){
  const dir=path.join(config.outputDir,'tasks',task.id,'evidence');await fs.mkdir(dir,{recursive:true});
  const filename=`${platform}-${label}-${Date.now()}.png`;await page.screenshot({path:path.join(dir,filename),fullPage:false,timeout:8000}).catch(()=>{});
  return `tasks/${task.id}/evidence/${filename}`;
 }
 async run(task,onlyPlatforms=null){
  this.running=task.id;const controller=new AbortController();this.controllers.set(task.id,controller);const signal=controller.signal;
  try{
   task.status='running';this.save(task);const context=await this.browser.open();
   const runStage=async stage=>{
    if(stage.status==='completed'||(onlyPlatforms&&!onlyPlatforms.includes(stage.platform)))return;if(signal.aborted){stage.status='stopped';stage.message='用户已安全停止';return;}
    const platform=stage.platform,protection=this.store.protection(platform);
    if(protection?.until&&Date.now()<Date.parse(protection.until)){stage.status='risk_controlled';stage.message=`本机${PLATFORMS[platform].name}保护等待至 ${new Date(protection.until).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}；未重新请求`;this.save(task);return;}
    if(platform==='zhihu'&&config.zhihuIsolation)return collectZhihu(this,task,stage,signal);
    let search,observer,retained=false;const previous=new Map(this.store.items(task.id).filter(i=>i.platform===platform).map(i=>[i.sourceId,i]));
    stage.accepted=[...previous.values()].filter(i=>i.contentStatus==='completed').length;stage.pendingContent=previous.size-stage.accepted;
    stage.status='searching';stage.evidence=null;stage.evidenceUrl=null;stage.message='打开平台搜索';this.save(task);this.log(task,platform,'开始检索：'+task.keyword);
    try{
     search=await this.browser.workPage(platform);const onAbort=()=>search.close().catch(()=>{});signal.addEventListener('abort',onAbort,{once:true});observer=new Observer(search,platform,{purpose:'search',keyword:task.keyword});
     const uiLog=(message,extra)=>this.log(task,platform,message,'info',extra);
     const submitted=await startUiSearch(search,platform,task.keyword,this.browser,{signal,log:uiLog});
     if(submitted!==search){observer.close();search=submitted;observer=new Observer(search,platform,{purpose:'search',keyword:task.keyword});this.browser.loginPages.set(platform,search);}
     await search.waitForTimeout(2500);await this.browser.gate(search);await observer.flush();
     // Optional login overlays that block the search are reported, not clicked
     // away to simulate authentication.
     const blockedModal=await search.locator('.SignFlowModal:visible,.signFlowModal:visible,.login-container:visible,.login-modal:visible').count();
     let candidates=await visibleCandidates(search,platform,observer);
     if(!candidates.length&&blockedModal)throw Object.assign(new Error('搜索需要先完成平台登录'),{code:'login_required'});
     const seen=new Set(),discovered=new Set(),visitedPages=new Set();let stale=0,explicitEnd=false,searchPage=1,scansOnPage=0,stopReason='';
     const maxPages=platform==='toutiao'?Math.max(1,config.maxSearchPages??20):1;
     const maxScans=(config.maxSearchScrolls??6)*maxPages;
     for(let scroll=0;scroll<maxScans&&!signal.aborted;scroll++){
      candidates=await visibleCandidates(search,platform,observer);for(const c of candidates)discovered.add(c.id);stage.discovered=discovered.size;stage.status='collecting';if(platform==='toutiao')stage.searchPage=searchPage;this.save(task);
      if(platform==='toutiao')this.log(task,platform,`搜索第 ${searchPage} 页：识别 ${candidates.length} 条本平台候选，累计 ${discovered.size} 条`, 'info',{action:'search_page_scan',searchPage,candidates:candidates.length,discovered:discovered.size});
      const fresh=candidates.filter(c=>!seen.has(c.id));
      for(const c of fresh){
       seen.add(c.id);if(signal.aborted||stage.accepted>=task.target)break;
       if(previous.get(c.id)?.contentStatus==='completed')continue;
       stage.message='读取详情：'+(c.title||c.id).slice(0,80);this.save(task);
       let detail,opened,keepBlockedDetail=false,close;try{
        opened=await clickCandidate(search,platform,c,this.browser,{signal,log:uiLog});detail=opened.page;
        const detailPage=detail;close=()=>detailPage.close().catch(()=>{});signal.addEventListener('abort',close,{once:true});
        await readDetail(opened,this.browser,{signal,log:uiLog});
        let item=await extractDetail(detail,platform,opened.candidate,this.browser,{alreadyOpened:true,openedObserver:opened.observer});
        item.navigationEvidence={mode:opened.mode,method:'visible_result_click',returnedBy:opened.mode==='inline'?'inline_list':opened.popup?'close_tab':platform==='xiaohongshu'?'top_left_close':'close_or_browser_back'};
        if(platform==='toutiao')item.navigationEvidence.searchPage=searchPage;
        if(signal.aborted)throw new Error('STOP_REQUESTED');
        const capture=await this.evidence(detail,task,platform,c.id);item.evidence=capture;
        if(item.kind==='video'){
         if(task.transcribeVideos){stage.status='transcribing';stage.message='等待转写资源；其他平台继续采集';this.save(task);item=await this.mediaSlots.run(()=>transcribe(item,task.id,{signal,onProgress:message=>{stage.message=message;this.save(task);this.log(task,platform,message);}}),signal);}
         else item.transcriptStatus='disabled';
        }
        item.contentStatus=item.kind==='video'?(item.transcriptStatus==='completed'?'completed':'pending'):'completed';
        item.contentHash=contentHash(item.kind==='video'?(item.transcript||item.body):item.body);item.mediaUrl=undefined;item.captionTracks=undefined;item.captions=undefined;
        this.store.item(task.id,item);this.knowledge?.enqueue(task.id,item);previous.set(item.sourceId,item);
        stage.accepted=[...previous.values()].filter(x=>x.contentStatus==='completed').length;stage.pendingContent=previous.size-stage.accepted;
        this.log(task,platform,item.contentStatus==='completed'?'正文已保存：'+item.title:'视频主体内容待补：'+item.title,item.contentStatus==='completed'?'info':'warning',{sourceId:c.id,transcriptStatus:item.transcriptStatus});
        signal.removeEventListener('abort',close);
       }catch(e){
        if(signal.aborted)throw e;
        if(/^SOURCE_ID_UNCONFIRMED|^SEARCH_CONTEXT_LOST|^DETAIL_CLOSE_NOT_FOUND/.test(e.message)){keepBlockedDetail=true;const evidencePage=e.detailPage||detail||search;if(evidencePage&&!evidencePage.isClosed()){stage.evidence=await this.evidence(evidencePage,task,platform,'navigation-incomplete');stage.evidenceUrl=evidencePage.url();}throw e;}
        if(e.scope!=='item'&&['login_required','verification_required','risk_controlled','access_denied'].includes(e.code)){
         detail=detail||e.detailPage;
         if(detail&&!detail.isClosed()){stage.evidence=await this.evidence(detail,task,platform,'detail-blocked');stage.evidenceUrl=detail.url();keepBlockedDetail=true;this.browser.loginPages.set(platform,detail);}
         if(task.autoResumeAfterLogin!==false&&detail&&!detail.isClosed()){
          await this.recovery.watch(task.id,platform,detail,e.code);this.browser.loginPages.set(platform,detail);detail=null;
          keepBlockedDetail=true;if(e.detailPage===search||opened?.page===search)retained=true;
         }throw e;
        }
        stage.failedDetails++;this.log(task,platform,'详情未完成：'+(e.message||'未知错误'),'warning',{sourceId:c.id});
       }finally{
        if(close)signal.removeEventListener('abort',close);
        if(opened&&!keepBlockedDetail&&!signal.aborted)await returnToResults(opened,this.browser,{signal,log:uiLog});
        else opened?.observer.close();
       }
       stage.status='collecting';this.save(task);if(stage.accepted>=task.target)break;await pace(search,'action',signal,uiLog);
      }
      if(stage.accepted>=task.target)break;
      if(platform==='toutiao'){
       if(searchPage>=maxPages){stopReason=`本轮达到 ${maxPages} 页扫描上限，未证明搜索全量结束`;break;}
       const next=await advanceToutiaoResults(search,this.browser,{keyword:task.keyword,signal,log:uiLog,visited:visitedPages});
       if(next.advanced){searchPage++;scansOnPage=0;stale=0;stage.searchPage=searchPage;stage.message=`已翻至搜索第 ${searchPage} 页，继续补足 ${stage.accepted}/${task.target} 条`;this.save(task);continue;}
       if(next.reason==='next_disabled'){explicitEnd=true;stopReason='页面下一页已禁用';break;}
       scansOnPage++;if(scansOnPage>=(config.maxSearchScrolls??6)){stopReason='本页扫描结束，未找到可用下一页，未证明搜索全量结束';break;}
      }
      const body=await search.locator('body').innerText();explicitEnd=/没有更多(内容|结果)|暂无搜索结果|未找到相关(内容|结果)|没有找到相关/.test(body);
      if(explicitEnd)break;if(!fresh.length)stale++;else stale=0;if(stale>=2)break;
      await search.mouse.move(800,650);await search.mouse.wheel(0,600+Math.floor(Math.random()*350));uiLog('滚动搜索结果列表',{action:'scroll_results'});await pace(search,'scroll',signal,uiLog);await this.browser.gate(search);
     }
     if(signal.aborted){stage.status='stopped';stage.message='已停止，已保存内容可继续';}
     else if(stage.accepted>=task.target){stage.status='completed';stage.message=`达到目标，完整主体内容 ${stage.accepted}/${task.target} 条`;}
     else{stage.status=stage.accepted||previous.size?'partial':'no_results';stage.message=`${stopReason||(explicitEnd?'页面显示搜索结束':'本次扫描结束，未证明搜索全量结束')}；完整正文 ${stage.accepted}/${task.target}，待补主体 ${stage.pendingContent}，详情失败 ${stage.failedDetails}`;}
     signal.removeEventListener('abort',onAbort);
    }catch(e){
     stage.status=signal.aborted?'stopped':e.code||'failed';if(!terminalStates.includes(stage.status))stage.status='failed';stage.message=signal.aborted?'用户已停止':e.message;
     if(e.cooldownMs){this.store.protect(platform,{machine:task.machine,reason:e.message,at:new Date().toISOString(),until:new Date(Date.now()+e.cooldownMs).toISOString()});}
     if(!stage.evidence&&search&&!search.isClosed()){stage.evidence=await this.evidence(search,task,platform,'blocked');stage.evidenceUrl=search.url();}this.log(task,platform,stage.message,'warning');
     if(!signal.aborted&&task.autoResumeAfterLogin!==false&&['login_required','verification_required','access_denied','risk_controlled'].includes(stage.status)&&search&&!search.isClosed()){
      const key=this.recovery.key(task.id,platform);if(!this.recovery.watches.has(key)){await this.recovery.watch(task.id,platform,search,stage.status);this.browser.loginPages.set(platform,search);retained=true;}
      stage.message+='；已保留验证页，页面恢复后自动续采';this.log(task,platform,'已建立页面变化监测；只读取已打开页面，不循环请求平台','info');
     }
    }finally{observer?.close();this.save(task);}
   };
   const slots=new Semaphore(config.platformConcurrency??5),jobs=new Set(),scheduled=new Set();
   const schedule=stage=>{if(scheduled.has(stage.platform))return false;scheduled.add(stage.platform);this.recovery.stopPlatform(task.id,stage.platform);const job=slots.run(()=>runStage(stage),signal).catch(e=>{stage.status=signal.aborted?'stopped':'failed';stage.message=e.message;this.save(task);}).finally(()=>{scheduled.delete(stage.platform);jobs.delete(job);const pending=this.pendingRecoveries.get(task.id);if(!signal.aborted&&pending?.delete(stage.platform))schedule(stage);});jobs.add(job);return true;};
   this.enqueueRecovery=platform=>{const stage=task.stages.find(s=>s.platform===platform);return!!stage&&!signal.aborted&&schedule(stage);};
   for(const stage of task.stages)if(stage.status!=='completed'&&(!onlyPlatforms||onlyPlatforms.includes(stage.platform)))schedule(stage);
   while(jobs.size)await Promise.allSettled([...jobs]);
  }catch(e){for(const stage of task.stages)if(!terminalStates.includes(stage.status)){stage.status=signal.aborted?'stopped':'failed';stage.message=e.message;}this.log(task,null,e.message,'error');}
  finally{
   this.enqueueRecovery=null;task.stopRequested=task.stopRequested||signal.aborted;task.status=task.stopRequested?'stopped':deriveTaskState(task.stages);task.finishedAt=new Date().toISOString();this.save(task);this.controllers.delete(task.id);this.running=null;
   const dir=path.join(config.outputDir,'tasks',task.id);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({task,items:this.scored(task.id)},null,2));
   this.drainRecoveries();
  }
 }
}
