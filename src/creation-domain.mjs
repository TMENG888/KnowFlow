import {createHash} from 'node:crypto';
export const hash=s=>createHash('sha256').update(s).digest('hex');
export const normalize=s=>String(s||'').replace(/\s+/g,' ').trim();
export const textOf=i=>String(i.kind==='video'?i.transcript:i.body||i.transcript||'').trim();
export const sourceKey=i=>i.platform+':'+i.sourceId;
export function articleStructure(item){
 const text=String(item.body||'').trim(),lines=text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
 const headings=[...new Set(lines.filter(s=>s.length>=3&&s.length<=90&&!/扫码|领取|免费分享|免费领取/.test(s)&&/^(?:#{1,6}\s+|第[一二三四五六七八九十百\d]+[章节部分]|[一二三四五六七八九十]+[、．.：:]|[（(][一二三四五六七八九十\d]+[）)]|\d+(?:\.\d+)*[、．.：:]\s*|(?:核心概念|工作原理|架构设计|总结|实现步骤|适用场景|优缺点)[：:]?\s*$)/.test(s)))];
 return {eligible:item.contentStatus==='completed'&&item.kind!=='video'&&text.length>=600&&lines.length>=6&&headings.length>=2,bodyChars:text.length,paragraphCount:lines.length,headingCount:headings.length,headings:headings.slice(0,12),method:'visible-headings-and-paragraphs-v1'};
}
export function recommendReference(items){
 const ranked=items.map(item=>({item,structure:articleStructure(item)})).filter(x=>x.structure.eligible&&Number.isFinite(x.item.influence?.score)).sort((a,b)=>b.item.influence.score-a.item.influence.score||b.structure.headingCount-a.structure.headingCount);
 if(!ranked.length)throw new Error('当前任务没有同时具备完整图文正文、明确章节结构和可用影响力分数的参考文章');
 const selected=ranked[0];return{...selected,eligibleCount:ranked.length,reason:`在 ${ranked.length} 篇有明确章节结构的完整图文文章中，互动指数最高；识别到 ${selected.structure.headingCount} 个标题、${selected.structure.paragraphCount} 段正文。`};
}
export function paragraphs(text){
 const out=[];for(const raw of text.split(/\n+/)){let s=raw.trim();while(s.length>800){let end=Math.max(s.lastIndexOf('。',800),s.lastIndexOf('！',800),s.lastIndexOf('？',800));if(end<200)end=799;out.push(s.slice(0,end+1));s=s.slice(end+1).trim();}if(s)out.push(s);}
 const pieces=out.length===1?out[0].split(/(?<=[。！？])/).filter(s=>s.trim()):out;
 return pieces.map((text,i)=>({id:i+1,text}));
}
export function chunks(text,max=360,overlap=50){
 const out=[];for(let start=0;start<text.length;){let end=Math.min(start+max,text.length);if(end<text.length){const candidate=Math.max(text.lastIndexOf('。',end-1),text.lastIndexOf('\n',end-1));if(candidate>start+max/2)end=candidate+1;}const content=text.slice(start,end).trim();if(content.length>=40)out.push({start,end,text:content,hash:hash(normalize(content))});if(end===text.length)break;start=Math.max(start+1,end-overlap);}
 return out;
}
export function corpus(items,reference){
 const refHash=hash(normalize(textOf(reference))),seen=new Set([refHash]);const refChunks=new Set(chunks(textOf(reference)).map(c=>c.hash));const result=[];
 for(const i of items){const text=textOf(i),h=hash(normalize(text));if(i.contentStatus!=='completed'||text.length<80||sourceKey(i)===sourceKey(reference)||i.url&&i.url===reference.url||seen.has(h))continue;seen.add(h);
  result.push({key:sourceKey(i),title:i.title,url:i.url,platform:i.platform,sourceId:i.sourceId,text,contentHash:h,chunks:chunks(text).filter(c=>!refChunks.has(c.hash))});
 }return result.filter(s=>s.chunks.length);
}
export function validateOutline(data,ps){
 if(typeof data.title!=='string'||!data.title.trim()||!Array.isArray(data.sections)||data.sections.length<2||data.sections.length>10)throw new Error('模型未返回有效的章节框架（需2—10段）');
 const ids=[];for(const s of data.sections){if(!s.heading?.trim()||!s.intent?.trim()||!s.query?.trim()||s.query.length>300||!Array.isArray(s.paragraphIds)||!s.paragraphIds.length)throw new Error('模型段落结构不完整');ids.push(...s.paragraphIds);}
 const excluded=data.excludedParagraphs||[];if(!Array.isArray(excluded)||excluded.some(p=>!Number.isInteger(p.id)||typeof p.reason!=='string'||!p.reason.trim()))throw new Error('排除段落缺少编号或原因');
 const all=[...ids,...excluded.map(p=>p.id)].sort((a,b)=>a-b);
 if(ids.some((id,n)=>!Number.isInteger(id)||n&&id<=ids[n-1])||all.length!==ps.length||all.some((id,n)=>id!==ps[n].id))throw new Error('语义切分未连续覆盖参考全文（或缺少明确排除说明），未进入召回');
 return {title:data.title.slice(0,150),excludedParagraphs:excluded,sections:data.sections.map((s,n)=>({id:n+1,heading:s.heading.slice(0,150),intent:s.intent.slice(0,1000),query:s.query,paragraphIds:s.paragraphIds}))};
}
export function cosine(a,b){if(a.length!==b.length||!a.length)throw new Error('向量维度不一致');let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i];}return x&&y?d/Math.sqrt(x*y):0;}
export function retrieve(query,candidates,{topK=5,minSimilarity=.45}={}){
 const seen=new Set(),bySource=new Map();return candidates.map(c=>({...c,similarity:cosine(query,c.vector)})).filter(c=>c.similarity>=minSimilarity).sort((a,b)=>b.similarity-a.similarity).filter(c=>{if(seen.has(c.hash)||(bySource.get(c.sourceKey)||0)>=2)return false;seen.add(c.hash);bySource.set(c.sourceKey,(bySource.get(c.sourceKey)||0)+1);return true;}).slice(0,topK).map(({vector,...c})=>c);
}
export function validateDraft(text,evidence){
 const cited=[...text.matchAll(/\[(C\d+)\]/g)].map(m=>m[1]),allowed=new Set(evidence.map(e=>e.citation));
 if(text.length<80||!cited.length||cited.some(id=>!allowed.has(id)))throw new Error('草稿缺少有效来源引用或引用不在召回证据中，未保存该段');
 return text;
}
export function markdown(job){const sources=new Map();for(const s of job.sections||[])for(const e of s.evidence||[])sources.set(e.citation,e);return (job.draft||'')+'\n\n---\n\n## 参考来源\n\n'+[...sources].map(([id,e])=>`- [${id}] ${e.title}（${e.platform}） ${e.url} · 分块 ${e.start}—${e.end}`).join('\n')+'\n\n> AI 辅助创作草稿，请核对事实、引用和表述后发布。\n';}
