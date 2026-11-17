export const editorText=value=>String(value||'').replace(/[\s\u200b-\u200d\ufeff]/g,'');
export function missingFinalImage(actual,document){
 let blocks=actual;
 if(blocks[0]?.type==='text'&&[document.title,document.sourceTitle].filter(Boolean).some(t=>editorText(t)===editorText(blocks[0].text)))blocks=blocks.slice(1);
 if(document.blocks.at(-1)?.type!=='image'||blocks.length!==document.blocks.length-1)return null;
 try{assertEditorBlocks(blocks,{blocks:document.blocks.slice(0,-1)});}catch{return null;}
 return document.images.find(i=>i.id===document.blocks.at(-1).imageId)||null;
}
export async function editorBlocks(editor,imageSelector){return editor.evaluate((e,selector)=>[...e.children].flatMap(c=>{if(c.matches('[data-type="image-widget"]'))return [];const images=[...c.querySelectorAll(selector)];if(images.length)return images.map(i=>({type:'image',loaded:i.complete&&i.naturalWidth>0,width:i.naturalWidth,height:i.naturalHeight}));const text=c.innerText?.replace(/[\u200b-\u200d\ufeff]/g,'').trim();return text?[{type:'text',text}]:[];}),imageSelector);}
export async function removeEmptyEditorParagraphs(page,editor,document,imageSelector){
 assertEditorBlocks(await editorBlocks(editor,imageSelector),document);
 let removed=0;
 for(let attempt=0;attempt<200;attempt++){
  const selected=await editor.evaluate(e=>{const children=[...e.children];const empty=c=>c.matches('p,h1,h2,h3')&&!c.innerText.replace(/[\s\u200b-\u200d\ufeff]/g,'')&&!c.querySelector('img,video,audio,iframe,table,[contenteditable=false],[data-type]');const n=children.findIndex((c,i)=>i<children.length-1&&empty(c));if(n<0)return null;const node=children[n],next=children[n+1];e.focus();const r=document.createRange();r.setStart(node,0);r.setEnd(next,0);const s=window.getSelection();s.removeAllRanges();s.addRange(r);return {inside:e.contains(s.anchorNode)&&e.contains(s.focusNode),text:s.toString(),count:children.length};});
  if(!selected)break;
  if(!selected.inside||editorText(selected.text))throw new Error('空白段落选区不安全，未修改');
  await page.keyboard.press('Backspace');
  const count=await editor.evaluate(e=>e.children.length);
  assertEditorBlocks(await editorBlocks(editor,imageSelector),document);
  if(count>=selected.count)throw new Error('空白段落删除未生效，已停止');removed++;
 }
 return {removed};
}
export function assertEditorBlocks(actual,document){const expected=document.blocks;if(actual.length!==expected.length)throw new Error('平台正文或插画数量与发布副本不同，未提交');for(let n=0;n<expected.length;n++){const a=actual[n],b=expected[n];if(a.type!==b.type||a.type==='text'&&editorText(a.text)!==editorText(b.text)||a.type==='image'&&!a.loaded)throw new Error('平台第 '+(n+1)+' 个正文/插画位置未通过核对，未提交');}return {textBlocks:actual.filter(b=>b.type==='text').length,images:actual.filter(b=>b.type==='image').length,orderVerified:true};}
export async function verifyEditor(page,editor,document,imageSelector){let blocks=await editorBlocks(editor,imageSelector);if(blocks[0]?.type==='text'&&[document.title,document.sourceTitle].filter(Boolean).some(t=>editorText(t)===editorText(blocks[0].text))){
 // Validate the remaining content before changing anything. In particular, never
 // delete from a caret left in an image or a different editor by a previous click.
 assertEditorBlocks(blocks.slice(1),document);
 const selected=await editor.evaluate(e=>{const first=[...e.children].find(c=>c.innerText?.replace(/[\u200b-\u200d\ufeff]/g,'').trim());const next=first?.nextElementSibling;if(!first||!next||!first.matches('p,h1,h2'))return null;e.focus();const r=document.createRange();r.setStart(first,0);r.setEnd(next,0);const s=window.getSelection();s.removeAllRanges();s.addRange(r);return {text:s.toString(),inside:e.contains(s.anchorNode)&&e.contains(s.focusNode)};});
 if(!selected?.inside||editorText(selected.text)!==editorText(blocks[0].text))throw new Error('导入标题选区未通过核对，未修改正文');
 await page.keyboard.press('Backspace');blocks=await editorBlocks(editor,imageSelector);
 }return assertEditorBlocks(blocks,document);}
