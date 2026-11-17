import {Observer} from './browser.mjs';
import {canonical} from './domain.mjs';
import {observedCovers,coverURL,isContentCover} from './collection-covers.mjs';

// Revisit an already collected original URL, never construct search/detail APIs.
export async function readOriginalCovers(page,item,entities=[]){
 const actual=canonical(item.platform,page.url());
 if(!actual||actual.id!==String(item.sourceId))throw new Error('原文页面身份不匹配，未更新封面');
 const id=String(item.sourceId).replace(/^(answer|article)-/,'');
 const raw=entities.findLast(v=>String(v.aweme_id||v.noteId||v.note_id||v.bvid||v.id||'')===id);
 const urls=observedCovers(item.platform,raw||{});
 if(!urls.length&&item.platform==='xiaohongshu'&&raw?.type!=='video'){
  const first=coverURL((raw?.imageList||raw?.image_list||[])[0]);if(first)urls.push(first);
 }
 const metadata=await page.evaluate(({platform,id})=>({
  poster:document.querySelector('video[poster]')?.poster,
  image:document.querySelector('meta[property="og:image"],meta[name="twitter:image"],meta[itemprop="image"]')?.content,
  noteCover:platform==='xiaohongshu'?[...document.querySelectorAll('a.cover[href]')].find(a=>{try{return new URL(a.href).pathname==='/explore/'+id;}catch{return false;}})?.querySelector('img')?.src:null
 }),{platform:item.platform,id:String(item.sourceId)});
 // Xiaohongshu's page-level og:image can be the generic site logo. Only use
 // a response associated with this note, or its own visible card cover.
 return [...new Set([...urls,metadata.noteCover,item.platform==='xiaohongshu'?null:metadata.image,item.kind==='video'?metadata.poster:null].map(coverURL).filter(u=>isContentCover(item.platform,u)))].slice(0,2);
}

export class CoverRecovery{
 constructor(store,{browser,archive,isBusy=()=>false,read=readOriginalCovers,observer=(page,platform)=>new Observer(page,platform)}={}){
  Object.assign(this,{store,browser,archive,isBusy,read,observer});this.active=null;this.promise=null;
 }
 start(taskId,{platforms=null}={}){
  if(this.active)return {...this.active,alreadyRunning:true};
  if(this.isBusy())throw new Error('请在采集任务停止后补取封面，避免占用同一浏览器');
  if(!this.store.task(taskId))throw new Error('任务不存在');
  const pending=this.store.items(taskId).filter(i=>(!platforms||platforms.includes(i.platform))&&!i.coverAssets?.some(a=>a.status==='completed')&&canonical(i.platform,i.url)?.id===String(i.sourceId));
  const job={taskId,total:pending.length,done:0,completed:0,failed:0,status:'running'};this.active=job;
  this.promise=this.run(job,pending).catch(e=>{job.status='failed';job.error=e.message;}).finally(()=>{this.last={...job};this.active=null;});
  return {...job,queued:pending.length};
 }
 async run(job,items){
  const blocked=new Set();
  this.store.event(job.taskId,{message:`开始重访原文补取 ${items.length} 条缺失或失效封面`,action:'cover_recovery'});
  for(const item of items){
   if(blocked.has(item.platform)){job.done++;job.failed++;continue;}
   if(this.isBusy()){job.status='paused';job.error='采集已启动，封面补取暂停';break;}
   let page,observer,retain=false;
   try{
    const context=item.platform==='zhihu'&&this.browser.settings?.zhihuIsolation?(await this.browser.zhihuPages()).detailContext:await this.browser.open();
    page=await context.newPage();observer=this.observer(page,item.platform);
    await this.browser.navigate(page,item.url);
    await observer.flush();
    const urls=await this.read(page,item,observer.entities);
    if(!urls.length)throw new Error('原文未提供可确认的封面地址');
    const current=this.store.items(job.taskId).find(i=>i.platform===item.platform&&i.sourceId===item.sourceId);if(!current)throw new Error('原记录已不存在');
    current.coverUrls=urls;current.coverUrl=urls[0];current.coverSource='original_page_revisit';current.coverRecovery={status:'observed',at:new Date().toISOString()};
    this.store.item(job.taskId,current);await this.archive.enqueue(job.taskId,current,{retry:true});
    if(!this.store.items(job.taskId).find(i=>i.platform===item.platform&&i.sourceId===item.sourceId)?.coverAssets.some(a=>a.status==='completed'))throw new Error('已取得封面地址，但下载失败');
    job.completed++;
   }catch(e){
    job.failed++;
    if(['login_required','verification_required','risk_controlled','access_denied'].includes(e.code)){blocked.add(item.platform);retain=true;}
    const current=this.store.items(job.taskId).find(i=>i.platform===item.platform&&i.sourceId===item.sourceId);
    if(current){current.coverRecovery={status:retain?'waiting_human':'failed',error:e.message,at:new Date().toISOString()};this.store.item(job.taskId,current);}
    this.store.event(job.taskId,{platform:item.platform,sourceId:item.sourceId,message:'补取封面：'+e.message,action:'cover_recovery',level:'warning'});
   }finally{observer?.close();if(page&&!retain)await page.close().catch(()=>{});job.done++;}
  }
  if(job.status==='running')job.status='completed';
  this.store.event(job.taskId,{message:`封面补取结束：成功归档 ${job.completed} 条，未完成 ${job.total-job.completed} 条${job.error?'；'+job.error:''}`,action:'cover_recovery',summary:{...job}});
 }
}
