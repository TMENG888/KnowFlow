// Shared by the reading view and server export. Stored chapter markers remain
// intact for canvas review, manual editing, history and section replacement.
export function readingArticle(draft=''){
 let fence=null,title=false;const out=[];
 for(const line of String(draft).replace(/\r\n?/g,'\n').split('\n')){
  const mark=/^\s{0,3}(`{3,}|~{3,})/.exec(line);
  if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence=null;out.push(line);continue;}
  if(fence){out.push(line);continue;}
  const heading=/^\s{0,3}(#{1,6})\s+/.exec(line);
  if(heading){if(heading[1].length===1&&!title){title=true;out.push(line);}else out.push('');continue;}
  // A legacy bold line may be a substantive assertion. Demote its styling
  // instead of deleting information on the assumption that it is a heading.
  const bold=/^\s*(?:\*\*([^*\n]{1,100})\*\*|__([^_\n]{1,100})__)\s*$/.exec(line);
  if(bold){out.push(bold[1]||bold[2]);continue;}
  out.push(line);
 }
 return out.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function textCharacters(text=''){
 let fence=null;
 const body=readingArticle(text).split('\n').filter(line=>{
  const mark=/^\s{0,3}(`{3,}|~{3,})/.exec(line);
  if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence=null;return false;}
  return fence||!/^\s{0,3}#\s+/.test(line);
 }).join('\n');
 const visible=body.replace(/\[[RC]\d+\]/g,'')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
  .replace(/^\s*(?:`{3,}|~{3,}).*$/gm,'').replace(/[*_`~]/g,'').replace(/\s/g,'');
 return Array.from(visible).length;
}
export function bodyHasHeadings(text=''){
 let fence=null;const lines=String(text).split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const line=lines[i],mark=/^\s{0,3}(`{3,}|~{3,})/.exec(line);
  if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence=null;continue;}
  if(fence)continue;
  if(/^\s{0,3}#{1,6}\s+/.test(line)||/^\s*(?:\*\*[^*\n]{1,100}\*\*|__[^_\n]{1,100}__)\s*$/.test(line)||i>0&&lines[i-1].trim()&&/^\s*(?:={3,}|-{3,})\s*$/.test(line))return true;
 }
 return false;
}
export function articleLengthAudit(reference,draft){
 const referenceCharacters=textCharacters(reference),characters=textCharacters(draft),min=Math.ceil(referenceCharacters*.8),max=Math.floor(referenceCharacters*1.2);
 return {referenceCharacters,characters,min,max,ratio:referenceCharacters?characters/referenceCharacters:null,withinRange:characters>=min&&characters<=max,unit:'正文有效字符（不含空白、引用编号、Markdown格式与标题）'};
}
