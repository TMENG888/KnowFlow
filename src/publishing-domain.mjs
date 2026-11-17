import {createHash} from 'node:crypto';
import {readingArticle} from '../public/article-policy.mjs';
import {currentIllustrationBody,illustratedDraft} from '../public/illustration-document.mjs';
import {currentTitleWorkflow} from './title-domain.mjs';

export const publicationChannels=[{id:'douyin',name:'抖音',enabled:true,format:'文章',titleLimit:30},{id:'wechat',name:'微信公众号',enabled:true,format:'文章',titleLimit:64},{id:'xiaohongshu',name:'小红书',enabled:false},{id:'toutiao',name:'今日头条',enabled:false}];
export const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export function publicationTargetKey(channel,url){try{const u=new URL(url),key=channel==='douyin'&&u.origin==='https://creator.douyin.com'?u.searchParams.get('creation_id'):channel==='wechat'&&u.origin==='https://mp.weixin.qq.com'?u.searchParams.get('appmsgid'):null;return key?channel+':'+key:null;}catch{return null;}}
export const escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function publicationDocument(job,{illustrationVersion='current',title,author='',coverImageId,coverMode='illustration',channel}={}){
 if(!['illustration','ai'].includes(coverMode)||coverMode==='ai'&&!['wechat','douyin'].includes(channel))throw new Error('无效封面方式或渠道');
 if(!['current','previous-complete'].includes(illustrationVersion))throw new Error('无效插图版本');
 if(!job.draft?.trim()||job.sections?.some(s=>!s.draft?.trim()))throw new Error('请先完成全部章节正文');
 const sections=structuredClone(job.sections||[]),images=[];
 for(const s of sections){
  if(s.illustrationPlan?.needed===false&&s.illustrationPlan.sourceText===currentIllustrationBody(job,s)&&s.illustrationPlan.items?.length===0)continue;
  const sourceText=currentIllustrationBody(job,s),valid=p=>p&&p.sourceText===sourceText&&Array.isArray(p.items)&&p.items.length>0&&p.items.every(i=>i.status==='completed'&&i.imageValidation?.passed!==false);
  const plan=illustrationVersion==='previous-complete'?[...(s.illustrationHistory||[]),s.illustrationPlan].find(valid):s.illustrationPlan;
  if(!plan){if(s.illustrationPlan||s.illustrationHistory?.length)throw new Error('第 '+s.id+' 章没有与正文匹配的完整插图版本');continue;}
  if(!valid(plan))throw new Error('第 '+s.id+' 章插图未完成、尺寸校验失败或正文已变更');
  s.illustrationPlan=plan;for(const item of plan.items)images.push({id:item.id,title:item.title,sectionId:s.id,url:item.imageUrl,filename:item.filename,mime:item.mime});
 }
 const markdown=readingArticle(illustratedDraft(job.draft,sections)).replace(/\[(?:R|C)\d+\]/g,'');
 const originalTitle=/^#\s+(.+)$/m.exec(markdown)?.[1]||job.outline?.title||job.reference?.title;
 title=String(title??currentTitleWorkflow(job)?.titles?.[channel]??originalTitle??'').trim();if(!title||/[\r\n]/.test(title)||title.length>100)throw new Error('请输入1至100字符的文章标题');
 const content=markdown.replace(/^#\s+.+(?:\n|$)/m,'').trim(),blocks=[];let offset=0;
 const addText=t=>{for(const p of t.split(/\n\s*\n/)){if(!p.trim())continue;blocks.push({type:'text',text:p.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'$1').trim()});}};
 for(const m of content.matchAll(/!\[([^\]]*)\]\((\/api\/creations\/[a-f\d-]{36}\/illustrations\/[a-f\d-]{36}\/image)\)/g)){addText(content.slice(offset,m.index));const img=images.find(i=>i.url===m[2]);if(!img)throw new Error('插图未匹配发布副本');blocks.push({type:'image',imageId:img.id});offset=m.index+m[0].length;}addText(content.slice(offset));
 if(blocks.filter(b=>b.type==='image').length!==images.length)throw new Error('部分插图的段落锚点失效，请先修复正文位置');
 author=String(author).trim();if(/[\r\n]/.test(author)||Array.from(author).length>8)throw new Error('公众号作者请填写1至8字符');
 coverImageId=coverImageId||images[0]?.id||null;if(coverImageId&&!images.some(i=>i.id===coverImageId))throw new Error('封面图片不在当前发布副本中');
 const document={title,author,coverImageId,coverMode,...(coverMode==='ai'?{coverChannel:channel}:{}),sourceTitle:originalTitle,blocks,images,illustrationVersion,creationId:job.id,creationUpdatedAt:job.updatedAt,characters:blocks.filter(b=>b.type==='text').reduce((n,b)=>n+b.text.replace(/\s/g,'').length,0)};
 return {...document,hash:digest({title,author,coverImageId,coverMode,...(coverMode==='ai'?{channel}:{}),blocks,images,creationId:job.id})};
}
export function publicationHtml(document,src=image=>image.url){
 return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(document.title)+'</title><style>body{font:18px/1.9 system-ui,"Microsoft YaHei",sans-serif;max-width:800px;margin:48px auto;padding:0 24px;color:#172333}h1{font-size:30px;line-height:1.4}p{white-space:pre-wrap}img{display:block;max-width:100%;height:auto;margin:28px auto}</style><article><h1>'+escapeHtml(document.title)+'</h1>'+document.blocks.map(b=>b.type==='image'?'<p><img alt="'+escapeHtml(document.images.find(i=>i.id===b.imageId).title)+'" src="'+escapeHtml(src(document.images.find(i=>i.id===b.imageId)))+'"></p>':'<p>'+escapeHtml(b.text)+'</p>').join('')+'</article></html>';
}
