// Anchors are based on the actual edited chapter, never an approximate search.
export function illustrationParagraphs(text=''){
 const out=[];let start=0,fence=null;
 const push=end=>{const raw=text.slice(start,end),lead=raw.length-raw.trimStart().length,body=raw.trim();if(body)out.push({id:out.length+1,text:body,start:start+lead,end:start+lead+body.length});};
 const lines=String(text).matchAll(/[^\n]*(?:\n|$)/g);for(const m of lines){if(!m[0])continue;const line=m[0],mark=/^\s{0,3}(`{3,}|~{3,})/.exec(line);if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence=null;}if(!fence&&!line.trim()){push(m.index);start=m.index+line.length;}}
 push(text.length);return out;
}
export function sectionSpan(draft,section){
 const headings=[];let fence=null;for(const m of draft.matchAll(/[^\n]*(?:\n|$)/g)){const mark=/^\s{0,3}(`{3,}|~{3,})/.exec(m[0]);if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence=null;continue;}if(!fence&&/^## [^\n]+\n$/.test(m[0]))headings.push({text:m[0].slice(3,-1),at:m.index,end:m.index+m[0].length});}
 const starts=headings.filter(h=>h.text===section.heading);if(starts.length!==1)return null;const from=starts[0].end,next=headings.find(h=>h.at>=from),raw=draft.slice(from,next?.at),lead=raw.length-raw.trimStart().length;
 return {start:from+lead,text:raw.trim()};
}
export function currentIllustrationBody(job,section){return sectionSpan(job.draft||'',section)?.text||(!job.draft?section.draft||'':'');}
export function illustratedDraft(draft='',sections=[]){
 const inserts=[];for(const section of sections){const plan=section.illustrationPlan,span=sectionSpan(draft,section);if(!plan||!span||plan.sourceText!==span.text)continue;const ps=illustrationParagraphs(span.text);
  for(const item of plan.items||[]){const p=ps[item.afterParagraph-1];if(item.status!=='completed'||!p||p.text!==item.anchorText||!/^\/api\/creations\/[a-f\d-]{36}\/illustrations\/[a-f\d-]{36}\/image$/.test(item.imageUrl||''))continue;
   const alt=String(item.title||'章节示意图').replace(/[\[\]\r\n]/g,' ');inserts.push({at:span.start+p.end,markdown:'\n\n!['+alt+']('+item.imageUrl+')'});
  }
 }
 for(const insert of inserts.reverse().sort((a,b)=>b.at-a.at))draft=draft.slice(0,insert.at)+insert.markdown+draft.slice(insert.at);return draft;
}
