// Review actions are explicit human decisions, never automatic truth labels.
export function sectionOf(job,id){const section=job.sections?.find(s=>s.id===Number(id));if(!section)throw new Error('章节不存在');return section;}
export function patchSectionDraft(job,section,text){
 const marker='## '+section.heading+'\n';
 if(!job.draft)return '# '+job.outline.title+'\n\n'+job.sections.filter(s=>s.id===section.id||s.draft).map(s=>'## '+s.heading+'\n\n'+(s.id===section.id?text:s.draft)).join('\n\n');
 const starts=[];let pos=0;while((pos=job.draft.indexOf(marker,pos))>=0){if(pos===0||job.draft[pos-1]==='\n')starts.push(pos);pos+=marker.length;}
 if(!starts.length&&!section.draft)return job.draft.trimEnd()+'\n\n'+marker+'\n'+text;
 if(starts.length!==1)throw new Error('全文中的章节标题已改动或重复；请恢复本章标题后再重写，避免覆盖人工编辑');
 const start=starts[0]+marker.length,tail=job.draft.slice(start),match=/\n## [^\n]+\n/.exec(tail),end=match?start+match.index:job.draft.length;
 return job.draft.slice(0,start)+'\n'+text+(match?'\n':'')+job.draft.slice(end);
}
export function auditSection(job,input){
 if(input.sectionId===undefined&&('referenceApproach' in input||'creationApproach' in input)){
  if(!job.outline)throw new Error('请先拆解写作框架');let changed=false;for(const key of ['referenceApproach','creationApproach'])if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>4000)throw new Error('写作思路最多4000字符');if(job.outline[key]!==input[key]){job.outline[key]=input[key];changed=true;}}if(!changed)return false;
  for(const section of job.sections)if(section.draft)section.draftStale=true;(job.auditLog||=[]).push({at:new Date().toISOString(),action:'writing-plan-review'});return true;
 }
 const s=sectionOf(job,input.sectionId);let changed=false;
 if(input.query!==undefined){if(typeof input.query!=='string'||!input.query.trim()||input.query.length>300)throw new Error('检索问题需为1—300字符');if(s.query!==input.query.trim()){s.query=input.query.trim();s.retrievalStale=true;s.draftStale=!!s.draft;changed=true;}}
 if(input.note!==undefined){if(typeof input.note!=='string'||input.note.length>2000)throw new Error('审核备注最多2000字符');if((s.reviewNote||'')!==input.note){s.reviewNote=input.note;s.draftStale=!!s.draft;changed=true;}}
 if(input.requirements!==undefined){if(typeof input.requirements!=='string'||input.requirements.length>3000)throw new Error('章节写作要求最多3000字符');if((s.requirements||'')!==input.requirements){s.requirements=input.requirements;s.draftStale=!!s.draft;changed=true;}}
 if(input.citation!==undefined){const e=[...(s.referenceEvidence||[]),...(s.evidence||[])].find(e=>e.citation===input.citation);if(!e)throw new Error('该证据不属于当前章节');if(!['pending','keep','exclude'].includes(input.decision))throw new Error('无效审核决定');if(input.reason!==undefined&&(typeof input.reason!=='string'||input.reason.length>2000))throw new Error('证据备注最多2000字符');e.review=input.decision;e.reviewNote=input.reason??e.reviewNote??'';e.reviewedAt=new Date().toISOString();s.draftStale=!!s.draft;changed=true;}
 if(!changed)return false;
 (job.auditLog||=[]).push({at:new Date().toISOString(),sectionId:s.id,action:input.citation?'evidence-review':'section-review',citation:input.citation,decision:input.decision,query:s.query,note:input.reason??input.note});job.auditLog=job.auditLog.slice(-500);return true;
}
export function snapshotDraft(job,section,reason){(job.draftHistory||=[]).push({at:new Date().toISOString(),sectionId:section.id,reason,draft:job.draft,sectionDraft:section.draft||''});job.draftHistory=job.draftHistory.slice(-20);}
export function eligibleEvidence(section,{reviewedOnly=false}={}){return [...(section.referenceEvidence||[]),...(section.evidence||[])].filter(e=>e.review!=='exclude'&&(!reviewedOnly||e.review==='keep'));}
export function writingContext(job,section){
 const previous=job.sections.filter(s=>s.id<section.id).map(s=>{const marker='## '+s.heading+'\n',at=job.draft?.indexOf(marker);let text=s.draft||'';if(at>=0){const tail=job.draft.slice(at+marker.length),next=/\n## [^\n]+\n/.exec(tail);text=(next?tail.slice(0,next.index):tail).trim();}return {id:s.id,heading:s.heading,text};}).filter(s=>s.text);
 let remaining=12000;for(let n=previous.length-1;n>=0;n--){const t=previous[n].text;previous[n].text=remaining?t.slice(-remaining):'';previous[n].truncated=t.length>remaining;remaining=Math.max(0,remaining-previous[n].text.length);}
 return {articleTitle:job.outline.title,referenceWritingApproach:job.outline.referenceApproach||'尚未分析参考文章的论证思路；按已提供章节目的组织',newArticleApproach:job.outline.creationApproach||job.instructions||'',directory:job.sections.map(s=>({id:s.id,heading:s.heading,intent:s.intent,requirements:s.requirements||'',reviewNote:s.reviewNote||''})),section:{id:section.id,heading:section.heading,intent:section.intent,requirements:section.requirements||'',reviewNote:section.reviewNote||''},precedingSections:previous.filter(s=>s.text),contextPolicy:'前文仅用于衔接、去重和保持术语一致，不作为独立事实证据。若截断已标注；本节事实仍须由所附证据支持。'};
}
export function validateApproach(data,sections){
 if(!data||typeof data.referenceApproach!=='string'||!data.referenceApproach.trim()||typeof data.creationApproach!=='string'||!data.creationApproach.trim()||!Array.isArray(data.sections)||data.sections.length!==sections.length)throw new Error('写作思路或章节要求不完整，可重试');
 const ids=data.sections.map(s=>Number(s.id));if(new Set(ids).size!==sections.length||ids.some(id=>!sections.some(s=>s.id===id))||data.sections.some(s=>typeof s.requirements!=='string'||!s.requirements.trim()))throw new Error('写作思路的章节编号或要求不完整，可重试');
 return {referenceApproach:data.referenceApproach.trim().slice(0,4000),creationApproach:data.creationApproach.trim().slice(0,4000),sections:data.sections.map(s=>({id:Number(s.id),requirements:s.requirements.trim().slice(0,3000)}))};
}
