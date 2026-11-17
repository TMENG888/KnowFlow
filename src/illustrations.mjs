import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {config} from './config.mjs';
import {illustrationParagraphs,currentIllustrationBody} from '../public/illustration-document.mjs';
import {illustrationCatalog,resolveVisualStyle,compileIllustrationPrompt,referenceAsset,illustrationHash,MAX_ILLUSTRATION_CONTENT_CHARS} from './illustration-style.mjs';
import {ILLUSTRATION_PLAN_SYSTEM} from './illustration-prompts.mjs';
export {ILLUSTRATION_PLAN_SYSTEM} from './illustration-prompts.mjs';
export function validateIllustrationPlan(data,ps,lockedStyle,catalog){
 if(typeof data?.needed!=='boolean'||typeof data.reason!=='string'||!data.reason.trim()||!Array.isArray(data.illustrations)||data.illustrations.length>2||data.needed!==!!data.illustrations.length)throw new Error('模型插图规划字段不完整或超出每章1—2张限制');
 const style=lockedStyle||resolveVisualStyle(data.style,catalog),seen=new Set();
 const items=data.illustrations.map(i=>{const p=ps.find(p=>p.id===i.afterParagraph);if(!p||/^\s*(`{3,}|~{3,})/.test(p.text)||typeof i.prompt!=='string'||i.prompt.length<15||i.prompt.length>MAX_ILLUSTRATION_CONTENT_CHARS||!i.title?.trim()||!i.purpose?.trim())throw new Error('插图位置或主题无效，内容提示词应为15至320字符，未提交生图');
  if(seen.has(i.prompt.trim()))throw new Error('模型返回重复插图');seen.add(i.prompt.trim());return {id:randomUUID(),afterParagraph:i.afterParagraph,anchorText:p.text,title:i.title.slice(0,120),purpose:i.purpose.slice(0,1000),prompt:i.prompt.trim(),status:'planned'};
 });for(const item of items)item.compiledPrompt=compileIllustrationPrompt(style,item);return {needed:data.needed,reason:data.reason.slice(0,2000),style,items};
}
export class IllustrationService{
 constructor({provider,browser,settings=config,assetLoader=referenceAsset}={}){this.provider=provider;this.browser=browser;this.settings=settings;this.assetLoader=assetLoader;}
 async regenerate(job,section,ctx={}){
  const previous=section.illustrationPlan,body=currentIllustrationBody(job,section);
  if(!previous||previous.sourceText!==body)throw new Error('正文或插图位置已变化，请先按当前正文重新规划');
  const items=previous.items.map(i=>({id:randomUUID(),afterParagraph:i.afterParagraph,anchorText:i.anchorText,title:i.title,purpose:i.purpose,prompt:i.prompt,status:'planned',regeneratedFrom:i.id}));
  for(const item of items){await this.compact(job,section,item,ctx.signal,ctx.save);item.compiledPrompt=compileIllustrationPrompt(job.visualStyle||previous.style,item);}
  (section.illustrationHistory||=[]).push(previous);section.illustrationHistory=section.illustrationHistory.slice(-3);
  section.illustrationPlan={...previous,items,regeneratedAt:new Date().toISOString(),promptPolicy:'general-v3'};
  ctx.save?.();return this.run(job,section,ctx);
 }
 async replan(job,section,ctx={}){
  if(job.visualAnchor||job.sections.some(s=>s.illustrationPlan?.items.some(i=>i.status==='completed')))throw new Error('已有合格样图，不能更换全文风格');
  const previous=section.illustrationPlan;if(!previous)throw new Error('尚无需要重新规划的插图');
  section.illustrationReplanFeedback={previousStyle:job.visualStyle,failures:previous.items.flatMap(i=>i.attempts||[]).map(a=>a.review.reason),instruction:'此前风格与图解表达反复不适配。正文和学习目标保持不变，从完整目录中选择另一种更适合简洁知识图解、可稳定复现的手绘风格，重新设计1至2张互补插图；按章节知识选择更清楚的图形结构，保留必要的先后、分支、反馈与条件。'};
  (job.visualStyleHistory||=[]).push(job.visualStyle);job.visualStyle=null;
  for(const s of job.sections){if(s.illustrationPlan){(s.illustrationHistory||=[]).push(s.illustrationPlan);s.illustrationHistory=s.illustrationHistory.slice(-3);s.illustrationPlan=null;}}
  ctx.save?.();return this.run(job,section,ctx);
 }
 async plan(job,section,{signal,save=()=>{}}={}){
  const body=currentIllustrationBody(job,section);if(!body)throw new Error('本章正文尚未完成，无法规划插图');
  const sourceHash=illustrationHash(body);if(section.illustrationPlan?.sourceHash===sourceHash)return section.illustrationPlan;
  const ps=illustrationParagraphs(body),catalog=await illustrationCatalog();
  const input={articleTitle:job.outline.title,chapter:{heading:section.heading,intent:section.intent,requirements:section.requirements},paragraphs:ps.map(({id,text})=>({id,text})),...(section.illustrationReplanFeedback?{restartFeedback:section.illustrationReplanFeedback}:{}),...(job.visualStyle?{lockedStyle:job.visualStyle}:{styleCatalog:catalog.styles.map(s=>({styleId:s.number,name:s.generation_name,reference:s.reference,traits:s.traits})),colorCatalog:catalog.colors.map(c=>({colorId:c.id,name:c.name_zh}))})};
  const r=await this.provider.chat(ILLUSTRATION_PLAN_SYSTEM,input,{json:true,signal,thinking:false});(job.usage||=[]).push({stage:'illustration-plan-'+section.id,model:r.model,usage:r.usage,at:new Date().toISOString()});save();let data;try{data=JSON.parse(r.content.replace(/^```json\s*|\s*```$/g,''));}catch{throw new Error('DeepSeek插图规划未返回有效JSON，原正文保留');}
  const plan=validateIllustrationPlan(data,ps,job.visualStyle,catalog);if(section.illustrationPlan)(section.illustrationHistory||=[]).push(section.illustrationPlan);section.illustrationHistory=(section.illustrationHistory||[]).slice(-3);job.visualStyle||=plan.style;
  section.illustrationPlan={...plan,promptPolicy:'general-v3',aspectRatio:'16:9',sourceText:body,sourceHash,model:r.model,plannedAt:new Date().toISOString()};save();return section.illustrationPlan;
 }
 async run(job,section,{signal,save=()=>{}}={}){
  const plan=await this.plan(job,section,{signal,save});if(!plan.needed)return plan;
  for(const item of plan.items){if(item.status==='completed')continue;
   if(item.status==='waiting_quota'){(item.rejectedSubmissions||=[]).push({checkpoint:item.checkpoint,reason:item.message,at:new Date().toISOString()});delete item.checkpoint;delete item.downloaded;item.status='planned';item.message='额度恢复后重新提交先前被拒绝的生图请求';save();}
   const progress=(status,message)=>{item.status=status;item.message=message;item.updatedAt=new Date().toISOString();job.progress=`第${section.id}章插图：${message}`;save();};
   try{const dir=path.join(this.settings.outputDir,'creations',job.id,'illustrations');await fs.mkdir(dir,{recursive:true});
    // A saved download needs no model call, style upload or new generation.
    if(!item.downloaded){
     const anchor=plan.style.referenceSha256?await this.sourceAnchor(plan.style):await this.anchor(job),styleFile=anchor?.path||await this.assetLoader(plan.style);
     item.styleReference=anchor?{kind:anchor.kind||'article-image',...(anchor.itemId?{itemId:anchor.itemId}:{}),...(anchor.source?{source:anchor.source}:{}),sha256:anchor.sha256}:{kind:'handraw-catalog',styleId:plan.style.styleId,commit:plan.style.commit};save();
     if(!item.checkpoint){await this.compact(job,section,item,signal,save);item.compiledPrompt=compileIllustrationPrompt(plan.style,item);}else if(!item.compiledPrompt)throw new Error('原提交缺少提示词断点，请人工核对；未重复提交');
     item.downloaded=await this.browser.generate(item,{styleFile,dir,signal,progress,checkpoint:save});save();
    }
    signal?.throwIfAborted();const result=item.downloaded;progress('validating','正在校验图片文件与16:9尺寸');
    if(!/^[-a-f\d]{36}\.(?:png|jpg|webp)$/.test(result.filename||''))throw new Error('插图下载文件记录无效，原请求已保留');
    const bytes=await fs.readFile(path.join(dir,result.filename));
    const passed=Number.isInteger(result.width)&&Number.isInteger(result.height)&&result.width>0&&result.height>0&&Math.abs(result.width/result.height-16/9)<=.025;
    item.imageValidation={passed,width:result.width,height:result.height,at:new Date().toISOString()};save();
    if(!passed)throw new Error(`图片实际尺寸${result.width}×${result.height}，需要16:9横版；已保留下载结果，请手动重新生成`);
    Object.assign(item,result,{status:'completed',completedAt:new Date().toISOString(),imageUrl:`/api/creations/${job.id}/illustrations/${item.id}/image`});delete item.downloaded;
    if(!job.visualAnchor)job.visualAnchor={itemId:item.id,sectionId:section.id,filename:result.filename,mime:result.mime,sha256:illustrationHash(bytes),createdAt:new Date().toISOString()};
    progress('completed','图片文件与尺寸校验完成，已插入正文');
   }catch(e){item.status=signal?.aborted?'paused':e.code==='DOUBAO_QUOTA_EXHAUSTED'?'waiting_quota':e.code==='DOUBAO_SUBMISSION_UNCERTAIN'?'needs_review':'failed';item.message=e.message;save();throw e;}
  }return plan;
 }
 async anchor(job){if(!job.visualAnchor){const first=job.sections.flatMap(s=>(s.illustrationPlan?.items||[]).map(i=>({...i,sectionId:s.id}))).find(i=>i.status==='completed'&&i.imageValidation?.passed!==false);if(first)job.visualAnchor={itemId:first.id,sectionId:first.sectionId,filename:first.filename,mime:first.mime};}const a=job.visualAnchor;if(!a)return null;if(!/^[-a-f\d]{36}\.(?:png|jpg|webp)$/.test(a.filename||''))throw new Error('全文风格样图记录无效');const file=path.join(this.settings.outputDir,'creations',job.id,'illustrations',a.filename),bytes=await fs.readFile(file),sha256=illustrationHash(bytes);if(a.sha256&&a.sha256!==sha256)throw new Error('全文风格样图文件发生变化，未自动更换参考');a.sha256=sha256;return {...a,path:file,bytes};}
 async sourceAnchor(style){const file=await this.assetLoader(style),bytes=await fs.readFile(file),sha256=illustrationHash(bytes);if(sha256!==style.referenceSha256)throw new Error('画风参考图内容发生变化，未生成');return{kind:'source-image',path:file,bytes,mime:style.referenceMime,sha256,source:style.source};}
 async compact(job,section,item,signal,save=()=>{}){if(item.prompt.length<=MAX_ILLUSTRATION_CONTENT_CHARS)return;if(!this.provider?.compactIllustrationPrompt)throw new Error('旧提示词过长，需要模型重新设计简洁图解，未截断或提交');const r=await this.provider.compactIllustrationPrompt({chapter:currentIllustrationBody(job,section),purpose:item.purpose,prompt:item.prompt},{signal});(item.promptRevisions||=[]).push({prompt:item.prompt,reason:'精简旧图解提示词',at:new Date().toISOString()});item.prompt=r.prompt;delete item.labels;(job.usage||=[]).push({stage:'illustration-compact-'+section.id,model:r.model,usage:r.usage,at:new Date().toISOString()});save?.();}
 async image(job,id){const item=job.sections.flatMap(s=>[s.illustrationPlan,...(s.illustrationHistory||[])].filter(Boolean).flatMap(p=>p.items)).find(i=>i.id===id);if(!item||item.status!=='completed'||!/^[-a-f\d]{36}\.(?:png|jpg|webp)$/.test(item.filename||''))throw new Error('插图不存在或尚未生成');return {bytes:await fs.readFile(path.join(this.settings.outputDir,'creations',job.id,'illustrations',item.filename)),mime:item.mime};}
}
