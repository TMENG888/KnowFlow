import {createHash} from 'node:crypto';
export const TITLE_VERSION='ranked-ten-v1';
export const titleBody=draft=>String(draft||'').replace(/^# [^\r\n]*(?:\r?\n|$)/m,'');
export const titleArticle=job=>titleBody(job.draft).replace(/^#{2,6} .+$/gm,'').replace(/\[(?:R|C)\d+\]/g,'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1');
export const titleSourceHash=job=>createHash('sha256').update(JSON.stringify([job.taskId,titleBody(job.draft),job.sections?.map(s=>[s.id,s.draft,!!s.draftStale,!!s.retrievalStale]),job.instructions||''])).digest('hex');
export function currentTitleWorkflow(job){const w=job.titleWorkflow;return w?.status==='completed'&&w.version===TITLE_VERSION&&w.sourceHash===titleSourceHash(job)?w:null;}
export function rankedTitleSamples(items){
 const sources=new Set(),titles=new Set();
 return [...items].filter(i=>typeof i.title==='string'&&i.title.trim()&&Number.isFinite(i.influence?.score)).sort((a,b)=>b.influence.score-a.influence.score||String(a.platform+':'+a.sourceId).localeCompare(String(b.platform+':'+b.sourceId))).filter(i=>{const key=i.platform+':'+i.sourceId,title=i.title.normalize('NFKC').replace(/\s/g,'').toLowerCase();if(sources.has(key)||titles.has(title))return false;sources.add(key);titles.add(title);return true;}).slice(0,10).map((i,n)=>({referenceId:'T'+(n+1),platform:i.platform,sourceId:i.sourceId,title:i.title.trim(),url:i.url,score:i.influence.score}));
}
const words=(v,max=800)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function validateTitlePlan(d,samples,article){
 const ids=samples.map(s=>s.referenceId),validRefs=(refs,min=1)=>Array.isArray(refs)&&refs.length>=min&&new Set(refs).size===refs.length&&refs.every(id=>ids.includes(id));
 if(!Array.isArray(d?.observations)||d.observations.length!==10||new Set(d.observations.map(o=>o.referenceId)).size!==10||d.observations.some(o=>!ids.includes(o.referenceId)||!words(o.structure,250)))throw new Error('标题分析必须逐一覆盖T1至T10的结构');
 if(!Array.isArray(d.patterns)||!d.patterns.length||d.patterns.length>6||d.patterns.some(p=>!words(p.id,20)||!words(p.structure,250)||!words(p.fit,500)||!validRefs(p.referenceIds,2))||new Set(d.patterns.map(p=>p.id)).size!==d.patterns.length)throw new Error('标题共性须由至少2个真实样本支持');
 const check=(c,limit,path)=>{if(!words(c?.title,limit)||/[\r\n#]/.test(c.title))throw new Error(path+'.title须为1至'+limit+'字符的单行标题，实际长度'+String(c?.title||'').length);if(!words(c.reason,600))throw new Error(path+'.reason缺少选用理由');if(!d.patterns.some(p=>p.id===c.patternId))throw new Error(path+'.patternId必须匹配patterns.id');if(!words(c.articleQuote,300)||!article.replace(/\s/g,'').includes(c.articleQuote.replace(/\s/g,'')))throw new Error(path+'.articleQuote不是本文连续原句，请从article原样摘录，不改写或拼接，实际返回：'+String(c.articleQuote).slice(0,150));if(samples.some(s=>s.title===c.title))throw new Error(path+'.title照搬了样本，请仅借鉴结构重新拟题');};
 check(d.main,64,'main');
 for(const [channel,limit] of [['wechat',64],['douyin',30]]){const c=d.channels?.[channel];if(!Array.isArray(c?.candidates)||c.candidates.length!==3||new Set(c.candidates.map(x=>x.title)).size!==3||!Number.isInteger(c.selectedIndex)||c.selectedIndex<0||c.selectedIndex>2)throw new Error('每个平台须提供3个不同标题及选用序号');c.candidates.forEach((x,n)=>check(x,limit,'channels.'+channel+'.candidates['+n+']'));}
 return d;
}
