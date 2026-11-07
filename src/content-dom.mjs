// Runs inside the ordinary rendered article. No hidden state or private API reads.
export function readContentDOM({platform}){
 const selectors={csdn:'#content_views,#article_content',toutiao:'article .article-content,.article-content,article',zhihu:'.AnswerItem .RichContent-inner .RichText,.Post-RichTextContainer .RichText,.Post-RichTextContainer,.AnswerItem .RichContent-inner',xiaohongshu:'#detail-desc,.note-content .desc,.note-container .desc',douyin:'[data-e2e="feed-active-video"] [data-e2e="video-desc"],[data-e2e="detail-video-desc"],[data-e2e="video-desc"]'};
 const root=document.querySelector(selectors[platform]||'article');if(!root)return[];
 const blocks=[];let text='',number=0;
 const flush=()=>{if(text.trim())blocks.push({type:'text',text:text.trim(),placement:'inline_dom'});text='';};
 const img=n=>{const url=n.getAttribute('data-original')||n.getAttribute('data-src')||n.currentSrc||n.src;if(/^https?:/.test(url||''))blocks.push({type:'image',id:'image-'+(++number),url,alt:n.getAttribute('alt')||'',placement:'inline_dom'});};
 const skip=n=>n.matches('script,style,noscript,button,nav,.avatar,.author,.author-container,.comments-container,[class*="emoji"],[class*="emoticon"]')||getComputedStyle(n).display==='none'||getComputedStyle(n).visibility==='hidden';
 function visit(n){if(n.nodeType===Node.TEXT_NODE){text+=n.textContent;return;}if(n.nodeType!==Node.ELEMENT_NODE||skip(n))return;if(n.tagName==='IMG'){flush();img(n);return;}if(n.tagName==='PRE'){flush();blocks.push({type:'code',text:'```\n'+n.innerText+'\n```',placement:'inline_dom'});return;}if(n.tagName==='BR'){flush();return;}const boundary=/^(P|DIV|SECTION|ARTICLE|FIGURE|FIGCAPTION|H[1-6]|UL|OL|LI|TABLE|TR|BLOCKQUOTE)$/.test(n.tagName);if(boundary)flush();for(const child of n.childNodes)visit(child);if(/^(TD|TH)$/.test(n.tagName))text+='\t';if(boundary)flush();}
 visit(root);flush();
 if(platform==='xiaohongshu'||platform==='douyin'){
  const gallery=document.querySelector(platform==='xiaohongshu'?'#noteContainer,.note-container':'[data-e2e="feed-active-video"]');
  const galleryImages=gallery?[...gallery.querySelectorAll('img')].filter(n=>!root.contains(n)&&!n.closest('.author,.avatar,.author-container,.comments-container,[class*="avatar"],[class*="emoji"]')&&!skip(n)):[];
  const before=[],after=[];for(const n of galleryImages){const arr=(n.compareDocumentPosition(root)&Node.DOCUMENT_POSITION_FOLLOWING)?before:after;const url=n.getAttribute('data-original')||n.getAttribute('data-src')||n.currentSrc||n.src;if(/^https?:/.test(url||''))arr.push({type:'image',id:'image-'+(++number),url,alt:n.alt||'',placement:arr===before?'gallery_before_text':'gallery_after_text'});}blocks.unshift(...before);blocks.push(...after);
 }
 return blocks.map((b,index)=>({...b,order:index,id:b.id||'text-'+index}));
}
