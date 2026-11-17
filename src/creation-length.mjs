import {textCharacters,articleLengthAudit} from '../public/article-policy.mjs';
export {textCharacters,articleLengthAudit};
export const OUTLINE_LENGTH_RULES='全文终稿预算为lengthBudget.article.min至max个有效字符，目标target；根据参考各部分的实际信息占比分配篇幅，合理合并信息少的段落，避免为每个小点扩张出长章节。不要规划每章固定一千字。章级标题仅保留在内部画布，大纲不安排章内小标题，最终阅读稿仅有文章主标题，正文以自然段衔接。此步骤仍严格返回所要求的JSON大纲。';
export const LENGTH_RULES='篇幅与终稿格式为硬约束：按lengthBudget.section给出的有效字符上下限和target撰写本章，中文字符、英文字符和标点均计数，空白、引用编号及Markdown格式不计。全文总量为参考正文的80%至120%，每章按参考内容占比分配，绝不是每章固定一千字。不要求用完全部召回材料，优先讲清本章必要机制、条件和实例；删除重复铺垫、泛泛总结与无关扩展，不能为凑字补造事实或删掉关键限定条件。章节标题仅用于画布审核，本节只返回连续自然段正文，严禁任何级别Markdown标题、独立加粗标题或另起小标题。直接承接前文，不使用“上一章/本章/下一章将介绍”等机械转场，文章须能连起来阅读。即使旧大纲或用户资料提到子标题，也遵守此终稿格式。';
function apportion(total,weights){
 if(!weights.length)return [];
 const sum=weights.reduce((a,b)=>a+b,0),raw=weights.map(w=>total*w/sum),out=raw.map(Math.floor);
 const ranked=raw.map((v,i)=>({i,remainder:v-out[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
 const missing=total-out.reduce((a,b)=>a+b,0);for(let n=0;n<missing;n++)out[ranked[n].i]++;
 return out;
}
export function lengthBudget(job,section){
 const audit=articleLengthAudit(job.reference?.text||'',job.draft||''),sections=job.sections||[];
 const weights=sections.map(s=>Math.max(1,(s.paragraphIds||[]).reduce((n,id)=>n+textCharacters(job.paragraphs?.find(p=>p.id===id)?.text||''),0)));
 const mins=apportion(audit.min,weights),toTarget=apportion(audit.referenceCharacters-audit.min,weights),toMax=apportion(audit.max-audit.referenceCharacters,weights),targets=mins.map((v,i)=>v+toTarget[i]),maxs=targets.map((v,i)=>v+toMax[i]),index=sections.findIndex(s=>s.id===section?.id);
 return {article:{...audit,target:audit.referenceCharacters},section:index<0?null:{id:section.id,min:mins[index],target:targets[index],max:maxs[index]},allocation:sections.map((s,i)=>({id:s.id,target:targets[i],min:mins[i],max:maxs[i]})),policy:'reference-80-120-v1',titlePolicy:'只保留文章主标题；章节标题仅用于画布'};
}
