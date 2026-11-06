import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {config} from './config.mjs';
function captions(item){const cues=item.captions||[];return cues.length?{text:cues.map(c=>c.text).join('\n'),segments:cues,source:'platform_captions',quality:'passed'}:null;}
export async function transcribe(item,taskId,{signal,onProgress=()=>{}}={}){
 const ready=captions(item);if(ready)return{...item,transcript:ready.text,transcriptAudit:ready,transcriptStatus:'completed'};
 if(!item.mediaUrl||!/^https?:/.test(item.mediaUrl))return{...item,transcriptStatus:'media_unavailable',transcriptError:'浏览器未取得可下载的完整媒体，标题与摘要未冒充视频正文'};
 if(item.durationSeconds>config.maxVideoSeconds)return{...item,transcriptStatus:'duration_limit',transcriptError:'视频超过单条转写时长上限，未截断冒充完整转写'};
 const dir=path.join(config.outputDir,'tasks',taskId,'media');await fs.mkdir(dir,{recursive:true});
 const base=path.join(dir,item.platform+'-'+item.sourceId),media=base+'.mp4',output=base+'.transcript.json';
 try{
  onProgress('下载媒体并提取音频');
  const response=await fetch(item.mediaUrl,{headers:{Referer:item.url,'User-Agent':'Mozilla/5.0'},redirect:'follow',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(120000)])});
  if(!response.ok||!response.body)throw new Error('MEDIA_HTTP_'+response.status);
  if(Number(response.headers.get('content-length'))>config.maxMediaBytes)throw new Error('MEDIA_SIZE_LIMIT');
  let size=0;const limiter=new Transform({transform(chunk,enc,callback){size+=chunk.length;if(size>config.maxMediaBytes)callback(new Error('MEDIA_SIZE_LIMIT'));else callback(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),limiter,createWriteStream(media+'.part'),{signal});await fs.rename(media+'.part',media);
  onProgress('音频字幕转写中');
  const args=[path.join(import.meta.dirname,'transcribe.py'),'--input',media,'--output',output,'--model',config.asrModel,'--temp',config.tempDir,'--max-seconds',String(config.maxVideoSeconds)];if(config.pythonSite)args.push('--site',config.pythonSite);
  await new Promise((resolve,reject)=>{
   const child=spawn(config.pythonExecutable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONPYCACHEPREFIX:path.join(config.tempDir,'pycache')}});let errors='';
   const timer=setTimeout(()=>{child.kill();reject(new Error('ASR_TIMEOUT'));},config.asrTimeoutMs);
   const abort=()=>{child.kill();reject(new Error('STOP_REQUESTED'));};signal?.addEventListener('abort',abort,{once:true});
   child.stderr.on('data',d=>{errors=(errors+d.toString()).slice(-2000);});child.stdout.resume();
   child.on('error',e=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(e);});child.on('exit',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);code===0?resolve():reject(new Error('ASR_FAILED: '+errors.slice(-600)));});
  });
  const result=JSON.parse(await fs.readFile(output,'utf8'));await fs.unlink(media).catch(()=>{});
  return{...item,mediaUrl:null,transcript:result.text,transcriptAudit:{...result,text:undefined},transcriptStatus:result.quality==='passed'?'completed':'review_required',audioFile:path.relative(config.outputDir,base+'.transcript.wav').replaceAll('\\','/'),transcriptFile:path.relative(config.outputDir,output).replaceAll('\\','/')};
 }catch(e){await fs.unlink(media+'.part').catch(()=>{});return{...item,mediaUrl:null,transcriptStatus:signal?.aborted?'stopped':'failed',transcriptError:e.message};}
}
