import {createHash} from 'node:crypto';
import {prepareKnowledge,finalizeKnowledge,sourceSignature} from './content-cleaning.mjs';
import {fetchImage} from './image-fetch.mjs';
import {DeepSeekProvider} from './creation-provider.mjs';
async function waitFor(work,signal){if(!signal)return work;if(signal.aborted)throw new Error('图片处理已暂停');let abort;try{return await Promise.race([work,new Promise((_,reject)=>{abort=()=>reject(new Error('图片处理已暂停'));signal.addEventListener('abort',abort,{once:true});})]);}finally{signal.removeEventListener('abort',abort);}}
export class KnowledgeService{
 constructor(store,{provider=new DeepSeekProvider(),download=fetchImage}={}){this.store=store;this.provider=provider;this.download=download;this.tasks=new Map();this.paused=new Set();this.itemWork=new Map();this.imageWork=Promise.resolve();}
 cleanExisting(){let count=0;for(const t of this.store.tasks())for(const i of this.store.items(t.id)){const old=i.knowledge;let reset=false;i.knowledge=prepareKnowledge(i);for(const b of i.knowledge.blocks)if(b.status==='processing'){b.status='pending';reset=true;}finalizeKnowledge(i.knowledge);if(reset||!old||old.sourceSignature!==i.knowledge.sourceSignature||old.version!==i.knowledge.version){this.store.item(t.id,i);count++;}}return count;}
 summary(taskId){const items=this.store.items(taskId);return {active:this.tasks.has(taskId),model:this.provider.model,items:items.length,cleaned:items.filter(i=>i.knowledge).length,images:items.reduce((a,i)=>{const s=prepareKnowledge(i).imageStats;for(const key of ['total','completed','pending','failed'])a[key]+=s[key];return a;},{total:0,completed:0,pending:0,failed:0}),unknownPosition:items.filter(i=>prepareKnowledge(i).positionStatus==='unknown_legacy').length};}
 start(taskId,{retry=false}={}){if(!this.store.task(taskId))throw new Error('采集任务不存在');if(this.tasks.has(taskId))return this.summary(taskId);this.paused.delete(taskId);const controller=new AbortController();this.tasks.set(taskId,controller);this.runTask(taskId,{signal:controller.signal,retry}).catch(e=>{this.paused.add(taskId);this.store.event(taskId,{platform:'knowledge',level:'warning',message:e.message});}).finally(()=>this.tasks.delete(taskId));return this.summary(taskId);}
 stop(taskId){this.paused.add(taskId);this.tasks.get(taskId)?.abort();return {stopping:true};}
 async runTask(taskId,{signal,retry=false}={}){const seen=new Set();while(!signal?.aborted){const item=this.store.items(taskId).find(i=>{const k=prepareKnowledge(i);return !seen.has(i.platform+':'+i.sourceId+':'+k.sourceSignature)&&(k.imageStats.pending||retry&&k.imageStats.failed);});if(!item)break;seen.add(item.platform+':'+item.sourceId+':'+sourceSignature(item));await this.enrichItem(taskId,item,{signal,retry});}}
 enqueue(taskId,item){if(prepareKnowledge(item).imageStats.pending&&!this.tasks.has(taskId)&&!this.paused.has(taskId))this.start(taskId);}
 async enrichItem(taskId,item,{signal,retry=false,onProgress=()=>{}}={}){
  const key=taskId+'|'+item.platform+':'+item.sourceId+'|'+sourceSignature(item);if(this.itemWork.has(key)){const result=await waitFor(this.itemWork.get(key),signal);item.knowledge=structuredClone(result.knowledge);return item;}
  const promise=this.processItem(taskId,item,{signal,retry,onProgress});this.itemWork.set(key,promise);try{return await promise;}finally{this.itemWork.delete(key);}
 }
 persist(taskId,item){const current=this.store.items(taskId).find(i=>i.platform===item.platform&&i.sourceId===item.sourceId);if(current&&sourceSignature(current)===sourceSignature(item))this.store.item(taskId,{...current,knowledge:item.knowledge});}
 async processItem(taskId,item,{signal,retry,onProgress}){
  item.knowledge=structuredClone(prepareKnowledge(item));const k=item.knowledge;this.persist(taskId,item);
  for(const [index,b] of k.blocks.entries()){
   if(b.type!=='image'||['completed','decorative'].includes(b.status)||!retry&&['failed','unreadable'].includes(b.status))continue;if(signal?.aborted)throw new Error('图片处理已暂停，已识别结果和原文保留');
   b.status='processing';delete b.error;finalizeKnowledge(k);this.persist(taskId,item);onProgress('识别图片：'+item.title+' · '+b.id);
   const operation=async()=>{if(signal?.aborted)throw new Error('操作已停止');const {bytes,mime}=await this.download(b.url,{signal,sourceURL:item.url}),hash=createHash('sha256').update(bytes).digest('hex'),cacheKey=this.provider.model+':vision-v1:'+hash;let result=this.store.imageDescription(cacheKey);
    if(!result){const textBefore=k.blocks.slice(0,index).filter(x=>x.type!=='image').at(-1)?.text||'',textAfter=k.blocks.slice(index+1).find(x=>x.type!=='image')?.text||'';result=await this.provider.describeImage({bytes,mime,context:{articleTitle:item.title,alt:b.alt||'',textBefore:textBefore.slice(-700),textAfter:textAfter.slice(0,700),position:b.placement}},{signal});if(signal?.aborted)throw new Error('操作已停止');this.store.saveImageDescription(cacheKey,result);}return {...result,contentHash:hash};};
   try{const run=this.imageWork.then(operation);this.imageWork=run.catch(()=>{});Object.assign(b,await run);}
   catch(e){b.status=signal?.aborted?'pending':'failed';b.error=e.message;}
   finalizeKnowledge(k);this.persist(taskId,item);if(signal?.aborted)throw new Error('图片处理已暂停，已识别结果和原文保留');if(/^DeepSeek HTTP (401|402|429)/.test(b.error||''))throw new Error('图片识别已暂停：'+b.error);
  }return item;
 }
}
