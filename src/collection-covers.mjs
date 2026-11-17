import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fetchImage} from './image-fetch.mjs';
import {config} from './config.mjs';

export function coverURL(value){
 if(value&&typeof value==='object')value=value.urlDefault||value.url_default||value.urlPre||value.url||value.url_list?.[0]||value.urlList?.[0];
 try{const u=new URL(String(value||'').replace(/^\/\//,'https://'));return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
export function isContentCover(platform,url){
 if(!url)return false;
 // CSDN's OG fallback is the site mascot, not an article's cover.
 return !(platform==='csdn'&&new URL(url).hostname.endsWith('csdnimg.cn')&&new URL(url).pathname.endsWith('/202112131616291007.png'));
}
export function observedCovers(platform,raw={}){
 const values=platform==='douyin'?[raw.video?.cover,raw.video?.origin_cover,raw.video?.originCover,raw.cover]:platform==='xiaohongshu'?[raw.cover,raw.video?.cover,raw.video?.image,(raw.imageList||raw.image_list||[])[0]]:platform==='zhihu'?[raw.title_image,raw.thumbnail,raw.thumbnail_info]:platform==='toutiao'?[raw.cover,raw.image_url,...(raw.image_list||[])]:platform==='bilibili'?[raw.pic]:[raw.cover,raw.cover_image,raw.pic];
 return [...new Set(values.map(coverURL).filter(u=>isContentCover(platform,u)))].slice(0,4);
}
export function normalizeCovers(item){
 const urls=[...new Set([...(item.coverUrls||[]),item.coverUrl].map(coverURL).filter(u=>isContentCover(item.platform,u)))].slice(0,4);
 // Historical B站 records explicitly stored the video poster as their first image.
 if(!urls.length&&item.platform==='bilibili'&&item.extractionVersion==='bilibili-single-result-v1'&&coverURL(item.images?.[0])){urls.push(coverURL(item.images[0]));item.coverSource='legacy_bilibili_poster';}
 if(!urls.length&&item.platform==='xiaohongshu'&&item.kind==='image'&&coverURL(item.images?.[0])){urls.push(coverURL(item.images[0]));item.coverSource='first_gallery_image';}
 if(item.coverSource==='legacy_bilibili_poster'){item.images=(item.images||[]).filter(u=>!urls.includes(coverURL(u)));item.imageUrls=(item.imageUrls||[]).filter(u=>!urls.includes(coverURL(u)));}
 item.coverUrls=urls;item.coverUrl=urls[0]||null;
 item.coverAssets=urls.map(url=>item.coverAssets?.find(a=>a.url===url)||{url,status:'pending'});
 return item;
}
const hash=value=>createHash('sha256').update(value).digest('hex');
export class CollectionCoverService{
 constructor(store,{outputDir=config.outputDir,download=fetchImage}={}){this.store=store;this.outputDir=outputDir;this.download=download;this.queue=Promise.resolve();this.pending=new Map();}
 enqueue(taskId,item,{retry=false}={}){
  normalizeCovers(item);const key=taskId+':'+item.platform+':'+item.sourceId;
  if(this.pending.has(key))return this.pending.get(key);
  if(!item.coverAssets.some(a=>a.status==='pending'||retry&&a.status==='failed'))return Promise.resolve();
  const work=this.queue.then(()=>this.archive(taskId,item,{retry})).catch(()=>{}).finally(()=>this.pending.delete(key));
  this.pending.set(key,work);this.queue=work;return work;
 }
 async capture(taskId,item,{signal}={}){
  normalizeCovers(item);
  await this.archive(taskId,item,{retry:true,signal,persist:false});
  item.coverCapture={source:'collection-detail',status:!item.coverAssets.length?'unavailable':item.coverAssets.some(a=>a.status==='completed')?'completed':'failed',capturedAt:new Date().toISOString()};
  return item;
 }
 async archive(taskId,item,{retry=false,signal,persist=true}={}){
  for(const asset of item.coverAssets){
   if(asset.status!=='pending'&&!(retry&&asset.status==='failed'))continue;
   let update;
   try{
    const {bytes,mime}=await this.download(asset.url,{sourceURL:item.url,maxBytes:10*1024*1024,signal});
    const ext={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif'}[mime];if(!ext)throw new Error('封面格式不受支持');
    const taskDir=/^[a-f\d-]{36}$/.test(taskId)?taskId:hash(String(taskId)).slice(0,32),platformDir=/^[a-z]+$/.test(item.platform)?item.platform:hash(String(item.platform)).slice(0,16);
    const sourceDir=/^[A-Za-z0-9-]{1,120}$/.test(String(item.sourceId))?String(item.sourceId):hash(String(item.sourceId)).slice(0,24);
    const rel=path.posix.join('tasks',taskDir,'covers',platformDir,sourceDir,hash(asset.url)+ext);
    const target=path.resolve(this.outputDir,rel);if(!target.startsWith(path.resolve(this.outputDir)+path.sep))throw new Error('封面存储路径异常');
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);
    update={url:asset.url,status:'completed',file:rel,mime,bytes:bytes.length,sha256:hash(bytes),savedAt:new Date().toISOString()};
   }catch(e){if(signal?.aborted)throw e;update={url:asset.url,status:'failed',error:e.message,attemptedAt:new Date().toISOString()};}
   item.coverAssets=item.coverAssets.map(a=>a.url===asset.url?update:a);
   if(!persist)continue;
   // A concurrent ASR/knowledge write must not be overwritten with an old item.
   const current=this.store.items(taskId).find(i=>i.platform===item.platform&&i.sourceId===item.sourceId);if(!current)continue;
   normalizeCovers(current);if(!current.coverUrls.includes(asset.url))continue;
   current.coverAssets=current.coverAssets.map(a=>a.url===asset.url?update:a);this.store.item(taskId,current);
  }
 }
 backfill(taskId,{retry=false}={}){const tasks=taskId?[this.store.task(taskId)].filter(Boolean):this.store.tasks();let count=0;for(const t of tasks)for(const item of this.store.items(t.id)){const before=JSON.stringify([item.coverUrl,item.coverUrls,item.coverAssets]);normalizeCovers(item);if(before!==JSON.stringify([item.coverUrl,item.coverUrls,item.coverAssets]))this.store.item(t.id,item);if(item.coverAssets.some(a=>a.status==='pending'||retry&&a.status==='failed')){count++;this.enqueue(t.id,item,{retry});}}return {queued:count};}
}
