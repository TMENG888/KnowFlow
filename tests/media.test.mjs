import test from 'node:test';
import assert from 'node:assert/strict';
import {asrArguments,ASR_MODEL_ID,transcribe,validateAsrConfiguration} from '../src/media.mjs';
import {config} from '../src/config.mjs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
test('one Qwen backend across all platforms with no legacy Python site injection',()=>{
 const settings={asrBackend:'qwen3-asr-0.6b',asrModel:'E:/model',tempDir:'E:/temp',maxVideoSeconds:1800,pythonSite:'C:/legacy-whisper'};
 const args=asrArguments('E:/video','E:/result',settings);
 assert.equal(ASR_MODEL_ID,'Qwen/Qwen3-ASR-0.6B');assert.equal(args.includes('--site'),false);assert.equal(args[args.indexOf('--device')+1],'auto');
 assert.throws(()=>asrArguments('x','y',{...settings,asrBackend:'whisper'}),/ASR_BACKEND_MISMATCH/);
});
test('platform captions do not bypass the selected ASR model or manufacture ASR completion',async()=>{
 for(const platform of ['douyin','xiaohongshu','toutiao','zhihu','csdn','bilibili']){
  const result=await transcribe({platform,sourceId:'fixture',captions:[{text:'本地单元测试字幕'}]},'fixture');
  assert.equal(result.transcriptStatus,'media_unavailable');assert.equal(result.transcript,undefined);assert.equal(result.platformCaptions.length,1);
 }
});

test('missing local model is rejected before downloading media or starting a Python process',async()=>{
 const old=config.asrModel,oldFetch=globalThis.fetch;let fetched=false;
 config.asrModel=path.join(config.tempDir,'missing-model-'+randomUUID());globalThis.fetch=async()=>{fetched=true;throw new Error('network must not start');};
 try{
  await assert.rejects(validateAsrConfiguration(),e=>e.code==='ASR_CONFIGURATION');
  const result=await transcribe({platform:'bilibili',sourceId:'fixture',mediaUrl:'https://example.org/video.mp4'},'fixture');
  assert.equal(result.transcriptStatus,'configuration_error');assert.match(result.transcriptError,/ASR_CONFIGURATION/);assert.equal(fetched,false);assert.equal(result.transcript,undefined);
 }finally{config.asrModel=old;globalThis.fetch=oldFetch;}
});
