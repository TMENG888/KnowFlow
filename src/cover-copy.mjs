export const COVER_COPY_VERSION='reader-hook-v1';
export const COVER_COPY_RULES='封面文案策划：先从本文提取读者在具体场景中的问题、矛盾、意外发现或可获得的理解，再拟3条不同切入角度的候选；不要只写品牌加动作、技术分类或抽象功能标签。每条须让读者看出这篇与自己有什么关系，以及读后能理解哪个具体问题。吸引力来自本文真实的信息差、情境冲突或方法价值，不用震惊、必看、颠覆等空泛修饰，不制造焦虑，不虚构数字、收益、成熟功能或保证。问句提出的疑问必须能在正文得到回答，不能用问号规避事实约束。不要只把功能陈述改成能不能、几件事之类的问句就当作创意；优先找到本文相对读者常识的具体反差、被忽视的瓶颈或方法前后的变化。3条不能只是替换动词或同义词；每条最多18字符，可以从熟悉的品牌入口或具体场景切入，不必让三条都机械重复品牌；最终选用的headline须包含真实认知入口entryTerm。返回copyStrategy:{candidates:[{headline,angle,readerQuestion,articleQuote,payoff,visualConnection}],selectedIndex,reason}。articleQuote须从article连续原样摘录，不能用参考文章、用户设计要求或样本内容代替正文依据；payoff说明正文实际如何回应读者，visualConnection说明现有主题画面怎样配合文案。选择最具体、最贴合全文核心矛盾且缩小后可迅速读懂的一条，最终headline必须与所选候选完全一致。tags只在补足核心意思时使用，不能堆分类词或重复主标题，无必要则为空。不要把copyStrategy的分析、依据和候选打印到图中。';

export function validateCoverCopy(data,{article,entryTerm}={}){
 const c=data.copyStrategy,norm=v=>String(v??'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
 const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max;
 if(!c||!Array.isArray(c.candidates)||c.candidates.length!==3||!Number.isInteger(c.selectedIndex)||c.selectedIndex<0||c.selectedIndex>2||!text(c.reason,500))throw new Error('copyStrategy须有3条不同角度候选、selectedIndex和选用理由');
 if(new Set(c.candidates.map(x=>norm(x.headline))).size!==3||new Set(c.candidates.map(x=>norm(x.angle))).size!==3)throw new Error('封面文案候选及切入角度须各不相同，不能只改同义词');
 for(const [index,x] of c.candidates.entries()){
  if(!text(x.headline,80)||Array.from(x.headline).length>18||/[\r\n]/.test(x.headline))throw new Error('候选'+index+'的headline“'+String(x.headline)+'”实际'+Array.from(String(x.headline||'')).length+'字符；须单行、最多18字符，请缩短并保持具体问题');
  if(['angle','readerQuestion','payoff','visualConnection'].some(k=>!text(x[k],500)))throw new Error('每条候选须说明切入角度、读者问题、正文回应及画面关联');
  if(!text(x.articleQuote,500)||!String(article||'').replace(/\s/g,'').includes(x.articleQuote.replace(/\s/g,'')))throw new Error('候选'+index+'的articleQuote“'+String(x.articleQuote).slice(0,150)+'”并非当前article连续原句；须从article复制，不改写、拼接或使用主题资料');
 }
 if(c.candidates[c.selectedIndex].headline!==data.headline)throw new Error('最终headline须与所选文案候选一致');
 return c;
}
