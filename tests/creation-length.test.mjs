import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {CreationService} from '../src/creation.mjs';
import {lengthBudget} from '../src/creation-length.mjs';
import {readingArticle,textCharacters,bodyHasHeadings,articleLengthAudit} from '../public/article-policy.mjs';
import {markdown} from '../src/creation-domain.mjs';
function fixture(){
 const store=new Store(':memory:'),j={id:'length',createdAt:'2026-11-08',taskId:'task',status:'review',model:'deepseek-flash',reference:{text:'甲'.repeat(150)+'乙'.repeat(50)},paragraphs:[{id:1,text:'甲'.repeat(150)},{id:2,text:'乙'.repeat(50)}],outline:{title:'文章'},draft:'',usage:[],sections:[1,2].map(id=>({id,heading:'章节'+id,paragraphIds:[id],intent:'理解',evidence:[{citation:'C'+id,text:'真实材料',review:'keep'}]}))};store.saveCreation(j);return {store,j};
}
async function idle(s){for(let n=0;n<300&&s.active;n++)await new Promise(r=>setTimeout(r,5));assert.equal(s.active,null);}
test('effective body count ignores title, format, whitespace and citation IDs consistently',()=>{
 assert.equal(textCharacters('# 标题\n\n## 画布章节\n\n**知识** 与 [术语](https://a.example)[C12]。'),6);
 assert.equal(textCharacters('知识 与 术语。'),6);
 assert.equal(textCharacters('```py\n# comment\n```'),8);
 assert.equal(textCharacters('😀'),1);
 for(const n of [80,120])assert.equal(articleLengthAudit('甲'.repeat(100),'乙'.repeat(n)).withinRange,true);
 for(const n of [79,121])assert.equal(articleLengthAudit('甲'.repeat(100),'乙'.repeat(n)).withinRange,false);
});
test('weighted budgets sum to article min, target and max with ordered integer bounds',()=>{
 const {store,j}=fixture(),b=lengthBudget(j,j.sections[0]);assert.deepEqual(b.section,{id:1,min:120,target:150,max:180});
 for(const key of ['min','target','max'])assert.equal(b.allocation.reduce((n,s)=>n+s[key],0),b.article[key]);
 assert.ok(b.allocation.every(s=>s.min<=s.target&&s.target<=s.max));assert.equal(lengthBudget({...j,sections:[]}).section,null);store.close();
});
test('reading and Markdown export retain main title and citations, leaving canvas markers untouched',()=>{
 const draft='# 文章\n\n## 第一章\n\n正文[C1]\n\n### 小标题\n\n后文\n\n**旧加粗小标题**\n\n```md\n## 示例代码\n```';
 const read=readingArticle(draft);assert.match(read,/^# 文章/);assert.doesNotMatch(read,/第一章|### 小标题/);assert.match(read,/旧加粗小标题/);assert.doesNotMatch(read,/\*\*旧加粗/);assert.match(read,/正文\[C1\]/);assert.match(read,/```md\n## 示例代码/);assert.match(draft,/## 第一章/);
 const exported=markdown({draft,sections:[]});assert.ok(exported.startsWith(read));assert.doesNotMatch(exported,/## 参考来源/);
 assert.equal(bodyHasHeadings('```md\n## 代码\n```'),false);assert.equal(bodyHasHeadings('### 小标题\n正文'),true);assert.equal(bodyHasHeadings('**小标题**\n正文'),true);
});
test('generation retries oversized and titled responses through the model, tracks usage and enforces final length',async()=>{
 const {store,j}=fixture();let calls=0;const inputs=[];
 const provider={model:j.model,verify:async()=>{},chat:async(system,input)=>{
  calls++;inputs.push(input);assert.match(system,/严禁任何级别Markdown标题/);assert.equal(input.directory.length,2);
  let content='知'.repeat(input.lengthBudget.section.target)+'['+input.evidence[0].citation+']';
  if(calls===1)content='长'.repeat(400)+'[C1]';if(calls===2)content='### 小标题\n'+content;
  return {content,model:j.model,usage:{total_tokens:10}};
 }};
 const service=new CreationService(store,{provider});service.start(j.id,'generate');await idle(service);const result=service.get(j.id);
 assert.equal(result.status,'draft');assert.equal(calls,4);assert.equal(result.usage.length,4);assert.match(inputs[1].revision.problem,/400/);assert.match(inputs[2].revision.problem,/小标题/);assert.ok(inputs[3].precedingSections[0].text);
 assert.equal(result.lengthAudit.characters,200);assert.equal(result.lengthAudit.withinRange,true);assert.match(result.draft,/## 章节1/);assert.doesNotMatch(readingArticle(result.draft),/^##/m);store.close();
});
test('three rejected model attempts preserve original draft and never silently truncate or report success',async()=>{
 const {store,j}=fixture();j.sections[0].draft='旧正文[C1]';j.draft='# 文章\n\n## 章节1\n\n旧正文[C1]';store.saveCreation(j);let calls=0;
 const service=new CreationService(store,{provider:{model:j.model,verify:async()=>{},chat:async()=>{calls++;return {content:'长'.repeat(500)+'[C1]'};}}});
 service.startSection(j.id,1,'rewrite');await idle(service);const result=service.get(j.id);
 assert.equal(result.status,'failed');assert.equal(calls,3);assert.equal(result.draft,j.draft);assert.equal(result.sections[0].draft,'旧正文[C1]');assert.equal(result.generatedAt,undefined);assert.equal(result.usage.length,3);assert.match(result.error,/仍未满足/);store.close();
});
test('resuming a legacy oversized checkpoint audits actual combined draft without rewriting it',async()=>{
 const {store,j}=fixture();j.sections.forEach(s=>s.draft='长'.repeat(300)+'[C'+s.id+']');j.draft='# 文章\n\n'+j.sections.map(s=>'## '+s.heading+'\n\n'+s.draft).join('\n\n');store.saveCreation(j);
 const service=new CreationService(store,{provider:{model:j.model,verify:async()=>{},chat:async()=>{throw new Error('不应重复调用');}}});service.start(j.id,'generate');await idle(service);const result=service.get(j.id);assert.equal(result.status,'failed');assert.equal(result.draft,j.draft);assert.equal(result.lengthAudit.characters,600);assert.match(result.error,/全文篇幅未达标/);store.close();
});
