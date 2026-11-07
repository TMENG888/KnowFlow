import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {config} from './config.mjs';
export const ASR_MODEL_ID='Qwen/Qwen3-ASR-0.6B';
export function asrArguments(media,output,settings=config){
 if(settings.asrBackend!=='qwen3-asr-0.6b')throw new Error('ASR_BACKEND_MISMATCH: KnowFlow统一使用Qwen3-ASR 0.6B');
 return[path.join(import.meta.dirname,'transcribe.py'),'--input',media,'--output',output,'--backend',settings.asrBackend,'--model',settings.asrModel,'--temp',settings.tempDir,'--max-seconds',String(settings.maxVideoSeconds),'--chunk-seconds',String(settings.asrChunkSeconds??25),'--threads',String(settings.asrThreads??8),'--device',settings.asrDevice??'auto','--language',settings.asrLanguage??'Chinese'];
}
export async function transcribe(item,taskId,{signal,onProgress=()=>{}}={}){
 // Platform subtitles are supplemental evidence; all new ASR uses one model.
 if(item.captions?.length)item={...item,platformCaptions:item.captions};
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
  onProgress('Qwen3-ASR 0.6B 音频转写中');
  const args=asrArguments(media,output);
  if(signal?.aborted)throw new Error('STOP_REQUESTED');
  await new Promise((resolve,reject)=>{
   const child=spawn(config.pythonExecutable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONPYCACHEPREFIX:path.join(config.tempDir,'pycache')}});let errors='';
   const timer=setTimeout(()=>{child.kill();reject(new Error('ASR_TIMEOUT'));},config.asrTimeoutMs);
   const abort=()=>{child.kill();reject(new Error('STOP_REQUESTED'));};signal?.addEventListener('abort',abort,{once:true});
   let pending='';child.stdout.on('data',d=>{pending+=d.toString();const lines=pending.split('\n');pending=lines.pop().slice(-4000);for(const line of lines)try{const event=JSON.parse(line);if(event.event==='chunk_completed')onProgress(`Qwen3-ASR 0.6B 已完成音频分段 ${event.chunk}/${event.total}`);}catch{}});
   child.stderr.on('data',d=>{errors=(errors+d.toString()).slice(-2000);});
   child.on('error',e=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(e);});child.on('exit',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);code===0?resolve():reject(new Error('ASR_FAILED: '+errors.slice(-600)));});
  });
  const result=JSON.parse(await fs.readFile(output,'utf8'));
  if(result.model!==ASR_MODEL_ID||result.backend!=='qwen3-asr-0.6b'||result.source!=='audio_asr'||!result.chunksExpected||result.chunksCompleted!==result.chunksExpected)throw new Error('ASR_RESULT_INVALID: 未确认Qwen0.6B完整转写');
  if(item.durationSeconds>0&&result.durationSeconds<item.durationSeconds-Math.max(3,item.durationSeconds*.02)){result.quality='review_required';result.qualityFlags=[...(result.qualityFlags||[]),'audio_shorter_than_video'];await fs.writeFile(output,JSON.stringify(result,null,2));}
  await fs.unlink(media).catch(()=>{});
  return{...item,mediaUrl:null,transcriptModel:result.model,transcript:result.text,transcriptAudit:{...result,text:undefined},transcriptStatus:result.quality==='passed'?'completed':'review_required',audioFile:path.relative(config.outputDir,base+'.transcript.wav').replaceAll('\\','/'),transcriptFile:path.relative(config.outputDir,output).replaceAll('\\','/')};
 }catch(e){await fs.unlink(media+'.part').catch(()=>{});return{...item,mediaUrl:null,transcriptStatus:signal?.aborted?'stopped':'failed',transcriptError:e.message};}
}
