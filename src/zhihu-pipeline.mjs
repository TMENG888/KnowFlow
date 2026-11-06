import {Observer} from './browser.mjs';
import {config} from './config.mjs';
import {canonical,contentHash} from './domain.mjs';
import {extractDetail} from './adapters.mjs';
import {startUiSearch,visibleCandidates,pace,readDetail} from './ui-navigation.mjs';
import {transcribe} from './media.mjs';

// The list produces only observed links. A separate anonymous browser consumes
// the durable queue; no storageState, cookies or localStorage cross this boundary.
export async function collectZhihu(engine,task,stage,signal){
 const {store,browser}=engine,platform='zhihu',log=(message,extra)=>engine.log(task,platform,message,'info',extra);
 const saved=new Map(store.items(task.id).filter(i=>i.platform===platform).map(i=>[i.sourceId,i]));
 stage.accepted=[...saved.values()].filter(i=>i.contentStatus==='completed').length;stage.pendingContent=[...saved.values()].filter(i=>i.contentStatus==='pending').length;
 stage.discovered=store.detailJobs(task.id).length;stage.failedDetails=0;
 stage.status='searching';stage.listStatus='starting';stage.detailStatus='waiting';stage.evidence=null;stage.evidenceUrl=null;stage.message='知乎双上下文：登录列表生产链接，未登录详情独立消费';engine.save(task);
 const pages=await browser.zhihuPages();let search=pages.list,detail=pages.detail,producerDone=false,listIssue=null,detailIssue=null,searchObserver;
 const abort=()=>{search.close().catch(()=>{});detail.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 const queueCount=()=>store.detailJobs(task.id).filter(j=>j.resultScope==='primary_search_result'&&['pending','reading','blocked'].includes(j.status)).length;
 const blocked=async(page,error,channel)=>{
  if(signal.aborted)return;
  stage.evidence=await engine.evidence(page,task,platform,channel+'-blocked');stage.evidenceUrl=page.url();
  if(error.cooldownMs)store.protect(platform,{machine:task.machine,reason:error.message,at:new Date().toISOString(),until:new Date(Date.now()+error.cooldownMs).toISOString()});
  if(task.autoResumeAfterLogin!==false&&['login_required','verification_required','access_denied','risk_controlled'].includes(error.code))await engine.recovery.watch(task.id,platform,page,error.code,{channel});
  log((channel==='list'?'列表侧':'未登录详情侧')+'暂停：'+error.message,{channel});
 };
 const produce=async()=>{
  try{
   searchObserver=new Observer(search,platform,{purpose:'search',keyword:task.keyword});
   const submitted=await startUiSearch(search,platform,task.keyword,browser,{signal,log});
   if(submitted!==search){searchObserver.close();search=submitted;browser.zhihuListPage=search;searchObserver=new Observer(search,platform,{purpose:'search',keyword:task.keyword});}
   stage.listStatus='collecting';engine.save(task);
   const seen=new Set();let stale=0;
   for(let scroll=0;scroll<config.maxSearchScrolls&&!signal.aborted&&stage.accepted<task.target;scroll++){
    const candidates=await visibleCandidates(search,platform,searchObserver);let fresh=0;
    for(const c of candidates){
     if(seen.has(c.id))continue;seen.add(c.id);fresh++;
     const actual=canonical(platform,c.clickHref);if(!actual||actual.id!==c.id)continue;
     const prior=store.detailJobs(task.id).find(j=>j.sourceId===c.id);
     const job={...prior,platform,sourceId:c.id,url:c.url,observedHref:c.clickHref,title:c.title,summary:c.summary,listUrl:search.url(),observedAt:new Date().toISOString(),resultScope:'primary_search_result',status:saved.get(c.id)?.contentStatus==='completed'?'completed':prior?.status==='scope_unverified'?'pending':prior?.status||'pending'};
     if(prior)store.saveDetailJob(task.id,job);else store.queueDetail(task.id,job);
    }
    stage.discovered=seen.size;stage.queuedDetails=queueCount();log('登录列表已保存真实详情链接：'+seen.size+' 条',{action:'queue_observed_links',channel:'list'});engine.save(task);
    if(!fresh)stale++;else stale=0;
    if(seen.size>=Math.max(task.target*3,10)||stale>=2)break;
    const body=await search.locator('body').innerText();if(/没有更多(内容|结果)|暂无搜索结果/.test(body))break;
    await search.mouse.move(650,650);await search.mouse.wheel(0,650);await pace(search,'scroll',signal,log);await browser.gate(search);
   }
   stage.listStatus=signal.aborted?'stopped':'finished';
  }catch(e){listIssue=e;stage.listStatus=signal.aborted?'stopped':e.code||'failed';if(!search.isClosed())await blocked(search,e,'list');}
  finally{producerDone=true;searchObserver?.close();engine.save(task);}
 };
 const consume=async()=>{
  const attempted=new Set();
  while(!signal.aborted&&stage.accepted<task.target){
   const pending=store.detailJobs(task.id).filter(j=>j.resultScope==='primary_search_result'&&!attempted.has(j.sourceId)&&['pending','reading','blocked'].includes(j.status));
   const currentId=canonical(platform,detail.url())?.id;
   const job=pending.find(j=>j.sourceId===currentId)||pending[0];
   if(!job){if(producerDone)break;await new Promise(r=>setTimeout(r,300));continue;}
   attempted.add(job.sourceId);
   if(saved.get(job.sourceId)?.contentStatus==='completed'){job.status='completed';store.saveDetailJob(task.id,job);continue;}
   let observer;
   try{
    if(canonical(platform,job.observedHref)?.id!==job.sourceId)throw new Error('OBSERVED_LINK_MISMATCH');
    stage.detailStatus='reading';stage.status='collecting';stage.message='未登录详情侧读取：'+job.title;job.status='reading';job.attemptedAt=new Date().toISOString();store.saveDetailJob(task.id,job);engine.save(task);
    const auth=await detail.context().cookies('https://www.zhihu.com');if(auth.some(c=>c.name==='z_c0'))throw Object.assign(new Error('详情上下文出现登录态，请在详情窗口退出登录后继续'),{code:'access_denied'});
    observer=new Observer(detail,platform);await pace(detail,'action',signal,log);
    log('将列表已观察链接交给独立未登录详情浏览器',{action:'observed_link_handoff',channel:'detail',sourceId:job.sourceId});
    // Read a manually recovered original page in place. Re-navigating it would
    // discard the user's recovery and issue an unnecessary new request.
    if(canonical(platform,detail.url())?.id===job.sourceId)await browser.gate(detail);else await browser.navigate(detail,job.observedHref);
    await readDetail({page:detail,platform},browser,{signal,log});
    let item=await extractDetail(detail,platform,{id:job.sourceId,url:job.url,title:job.title,summary:job.summary},browser,{alreadyOpened:true,openedObserver:observer});
    item.navigationEvidence={method:'observed_result_link_handoff',mode:'isolated_context',listUrl:job.listUrl,observedHref:job.observedHref,observedAt:job.observedAt,resultScope:job.resultScope,listAuth:'separate_persistent_context',detailAuth:'anonymous_context',cookiesTransferred:false};
    item.evidence=await engine.evidence(detail,task,platform,job.sourceId);
    if(item.kind==='video'&&task.transcribeVideos)item=await engine.mediaSlots.run(()=>transcribe(item,task.id,{signal,onProgress:message=>{stage.message=message;engine.save(task);}}),signal);
    item.contentStatus=item.kind==='video'?(item.transcriptStatus==='completed'?'completed':'pending'):'completed';item.contentHash=contentHash(item.transcript||item.body);delete item.mediaUrl;delete item.captionTracks;delete item.captions;
    if(signal.aborted)throw new Error('STOP_REQUESTED');store.item(task.id,item);saved.set(item.sourceId,item);job.status=item.contentStatus==='completed'?'completed':'pending_content';job.finishedAt=new Date().toISOString();store.saveDetailJob(task.id,job);
    stage.accepted=[...saved.values()].filter(i=>i.contentStatus==='completed').length;stage.pendingContent=[...saved.values()].filter(i=>i.contentStatus==='pending').length;stage.queuedDetails=queueCount();engine.save(task);log('未登录详情正文已保存：'+item.title,{channel:'detail',sourceId:item.sourceId});
   }catch(e){
    job.status=signal.aborted?'pending':e.scope==='item'?'restricted':'blocked';job.error=e.message;store.saveDetailJob(task.id,job);stage.failedDetails++;
    if(e.scope==='item'){log('该篇受内容权限限制，保留缺口并读取其他已排队文章',{sourceId:job.sourceId});continue;}
    detailIssue=e;stage.detailStatus=signal.aborted?'stopped':e.code||'failed';if(!detail.isClosed())await blocked(detail,e,'detail');break;
   }finally{observer?.close();}
  }
  if(!detailIssue)stage.detailStatus=signal.aborted?'stopped':'finished';
 };
 try{await Promise.allSettled([produce(),consume()]);}
 finally{signal.removeEventListener('abort',abort);stage.queuedDetails=queueCount();
  if(signal.aborted){stage.status='stopped';stage.message='已安全停止，两侧断点保留';}
  else if(stage.accepted>=task.target){stage.status='completed';stage.message=`独立未登录详情浏览器已保存完整正文 ${stage.accepted}/${task.target} 条`;engine.recovery.stopPlatform(task.id,platform);}
  else{const issue=detailIssue||listIssue;stage.status=issue?(issue.code||'failed'):((stage.accepted||saved.size)?'partial':'no_results');if(!['login_required','verification_required','access_denied','risk_controlled','partial','no_results'].includes(stage.status))stage.status='failed';stage.message=`列表侧 ${stage.listStatus}；详情侧 ${stage.detailStatus}；完整正文 ${stage.accepted}/${task.target}。${issue?.message||'本次可用链接扫描结束，未证明平台全量结束'}`;}
  engine.save(task);
 }
}
