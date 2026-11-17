import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DeepSeekProvider} from '../src/creation-provider.mjs';
import {IllustrationService} from '../src/illustrations.mjs';
import {illustrationHash} from '../src/illustration-style.mjs';
import {illustratedDraft} from '../public/illustration-document.mjs';
import {config} from '../src/config.mjs';

test('downloaded legacy reviewing checkpoint resumes without model calls, style loading or generation',async()=>{
 const dir=await fs.mkdtemp(path.join(config.tempDir,'illustration-no-review-'));
 try{
  const id=randomUUID(),image=randomUUID(),body='本章解释任务分派和执行。';
  const item={id:image,afterParagraph:1,anchorText:body,status:'reviewing',title:'任务分派',downloaded:{filename:image+'.png',mime:'image/png',width:1600,height:900}};
  const job={id,draft:'# 文章\n\n## 章节\n\n'+body,sections:[{id:1,heading:'章节',illustrationPlan:{needed:true,sourceText:body,sourceHash:illustrationHash(body),items:[item]}}],usage:[]};
  const folder=path.join(dir,'creations',id,'illustrations');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,image+'.png'),'saved download');
  const fail=async()=>{throw Error('No external work allowed for saved download');};
  const service=new IllustrationService({settings:{outputDir:dir},provider:{chat:fail,reviewIllustration:fail,repairIllustrationPrompt:fail},browser:{generate:fail},assetLoader:fail});
  await service.run(job,job.sections[0]);
  assert.equal(item.status,'completed');assert.equal(item.imageValidation.passed,true);assert.equal(item.visualReview,undefined);assert.equal(item.downloaded,undefined);
  assert.deepEqual(job.usage,[]);assert.match(illustratedDraft(job.draft,job.sections),/!\[任务分派\]/);
  await service.run(job,job.sections[0]);assert.equal(item.status,'completed');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('historical review rejection never triggers prompt repair or a second generation',async()=>{
 const dir=await fs.mkdtemp(path.join(config.tempDir,'illustration-no-review-'));
 try{
  const id=randomUUID(),image=randomUUID(),body='本章解释任务分派和执行。',old={review:{accepted:false,reason:'历史关系遗漏'}};
  const item={id:image,afterParagraph:1,anchorText:body,status:'failed',title:'任务分派',purpose:'理解分派',prompt:'从Router分派到Worker再返回结果的示意图。',attempts:[old]};
  const style={name:'测试风格',styleId:'test'},job={id,draft:'# 文章\n\n## 章节\n\n'+body,sections:[{id:1,heading:'章节',illustrationPlan:{needed:true,style,sourceText:body,sourceHash:illustrationHash(body),items:[item]}}],usage:[]};
  let calls=0;const fail=async()=>{throw Error('Model review and automatic repair removed');};
  const service=new IllustrationService({settings:{outputDir:dir},assetLoader:async()=>'/reference.webp',provider:{reviewIllustration:fail,repairIllustrationPrompt:fail},browser:{generate:async(i,{dir})=>{calls++;await fs.writeFile(path.join(dir,i.id+'.png'),'new image');return{filename:i.id+'.png',mime:'image/png',width:1600,height:900};}}});
  await service.run(job,job.sections[0]);assert.equal(calls,1);assert.deepEqual(item.attempts,[old]);assert.equal(item.imageValidation.passed,true);assert.deepEqual(job.usage,[]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('provider no longer exposes illustration review; knowledge image description remains available',()=>{
 const p=new DeepSeekProvider();assert.equal(p.reviewIllustration,undefined);assert.equal(typeof p.describeImage,'function');assert.equal(typeof p.compactIllustrationPrompt,'function');
});
