import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {configuredIllustrationStyle,compileIllustrationPrompt,referenceAsset,illustrationHash} from '../src/illustration-style.mjs';
import {IllustrationService,validateIllustrationPlan} from '../src/illustrations.mjs';import {illustrationParagraphs} from '../public/illustration-document.mjs';import {config} from '../src/config.mjs';import {DeepSeekProvider} from '../src/creation-provider.mjs';
const style=configuredIllustrationStyle({illustrationStylePreset:'author-graphrag'});
test('the actual article reference is pinned; verbose legacy traits and repeated style prose never enter the submitted prompt',async()=>{
 const file=await referenceAsset(style);assert.equal(illustrationHash(await fs.readFile(file)),style.referenceSha256);
 const content='左侧用户提交任务，中间Router分派给右侧并行Worker，结果返回Router统一答复。';
 const prompt=compileIllustrationPrompt({...style,traits:'人物解剖要求'.repeat(1000)},{prompt:content,labels:['废弃标签']});
 assert.ok(prompt.length<200);assert.equal(prompt.split('16:9').length-1,1);assert.ok(prompt.endsWith(content));assert.ok(!prompt.includes('人物解剖要求'));assert.ok(!prompt.includes('废弃标签'));
 assert.throws(()=>compileIllustrationPrompt(style,{prompt:'长'.repeat(321)}),/模型精简/);
 await assert.rejects(referenceAsset({...style,referenceSha256:'changed'}),/版本不一致/);
});
test('overlong model designs are rejected rather than truncated into misleading diagrams',()=>{
 const ps=illustrationParagraphs('正文知识。'),plan={needed:true,reason:'需要对比',illustrations:[{afterParagraph:1,title:'对比',purpose:'理解两种方式',prompt:'必要知识'.repeat(100)}]};
 assert.throws(()=>validateIllustrationPlan(plan,ps,style,{}),/320/);
});
test('legacy compaction asks the model to redesign and keeps the old wording in the audit trail',async()=>{
 const provider=new DeepSeekProvider();let input;provider.chat=async(_,i)=>{input=i;return{content:JSON.stringify({prompt:'用三张卡片表现：提交任务、并行执行、汇总回答，箭头按顺序连接。'}),model:'deepseek-flash',usage:{total_tokens:100}};};
 const service=new IllustrationService({provider}),old='旧知识和重复限制。'.repeat(100),j={draft:'',visualStyle:style,usage:[]},section={id:1,draft:'真实知识：任务分派与并行执行。'},item={prompt:old,purpose:'理解任务分工'};
 await service.compact(j,section,item);assert.equal(input.task,'compact');assert.equal(input.chapter,section.draft);assert.equal(item.promptRevisions[0].prompt,old);assert.ok(item.prompt.length<=320);
});
test('both images upload the same original reference without model review or drift',async()=>{
 const dir=path.join(config.tempDir,'illustration-tests',randomUUID()),refs=[],sourceBytes=await fs.readFile(await referenceAsset(style));
 const j={id:randomUUID(),draft:'# 文章\n\n## 章节\n\n内容一。\n\n内容二。',outline:{title:'文章'},visualStyle:style,sections:[{id:1,heading:'章节'}],usage:[]};
 const service=new IllustrationService({settings:{outputDir:dir},provider:{chat:async()=>({content:JSON.stringify({needed:true,reason:'两个独立知识',illustrations:[1,2].map(n=>({afterParagraph:n,title:'图'+n,purpose:'梳理一个知识',prompt:'从任务发起到完成的顺序步骤，用简洁卡片连接展示。'+n}))}),model:'deepseek-flash'}),reviewIllustration:async()=>{throw Error('Removed review must never run');}},browser:{generate:async(i,{dir,styleFile})=>{refs.push(styleFile);await fs.writeFile(path.join(dir,i.id+'.png'),'candidate-image');return{filename:i.id+'.png',mime:'image/png',width:1600,height:900};}}});
 await service.run(j,j.sections[0]);assert.equal(refs.length,2);assert.equal(refs[0],refs[1]);assert.ok(j.sections[0].illustrationPlan.items.every(i=>i.styleReference.sha256===illustrationHash(sourceBytes)&&i.imageValidation.passed&&!i.visualReview));assert.equal(j.sections[0].illustrationPlan.items[1].styleReference.kind,'source-image');
});

test('resuming a submitted legacy request keeps its exact prompt and never compacts or resubmits it',async()=>{
 const dir=path.join(config.tempDir,'illustration-tests',randomUUID()),body='已完成的章节正文。',submitted='旧版提交提示词。'.repeat(100),j={id:randomUUID(),draft:'# 文章\n\n## 章节\n\n'+body,outline:{title:'文章'},visualStyle:style,sections:[{id:1,heading:'章节'}],usage:[]};
 const item={id:randomUUID(),afterParagraph:1,anchorText:body,title:'旧请求',purpose:'理解本章',prompt:'长'.repeat(500),compiledPrompt:submitted,checkpoint:{phase:'submitted',submittedPrompt:submitted},status:'generating'};
 j.sections[0].illustrationPlan={needed:true,style,sourceText:body,sourceHash:illustrationHash(body),items:[item]};let resumed=0;
 const service=new IllustrationService({settings:{outputDir:dir},provider:{compactIllustrationPrompt:async()=>{throw Error('不应重新设计已提交请求');},reviewIllustration:async()=>{throw Error('Removed review must never run');}},browser:{generate:async(i,{dir})=>{resumed++;assert.equal(i.compiledPrompt,submitted);assert.equal(i.checkpoint.submittedPrompt,submitted);await fs.writeFile(path.join(dir,i.id+'.png'),'resumed-image');return{filename:i.id+'.png',mime:'image/png',width:1600,height:900};}}});
 await service.run(j,j.sections[0]);assert.equal(resumed,1);assert.equal(item.status,'completed');assert.equal(item.prompt.length,500);
});
