import {createHash} from 'node:crypto';
export const KNOWLEDGE_VERSION='ordered-clean-vision-v1';
const digest=s=>createHash('sha256').update(s).digest('hex');
const emoji=/(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;
const namedEmoji=/\[(?:doge|doge脸|笑哭|捂脸|呲牙|微笑|大笑|偷笑|害羞|哭惹|哭哭|大哭|可怜|失望|惊恐|惊讶|思考|点赞|赞|比心|爱心|红色心形|玫瑰|鼓掌|握手|抱拳|害羞R|笑哭R|捂脸R|暗中观察R|斜眼R|偷笑R|赞R)\]/gi;
export function cleanText(value){
 const raw=String(value||'').replace(/\r\n?/g,'\n').normalize('NFC');let fenced=false;
 const out=[];for(let line of raw.split('\n')){if(/^\s*```/.test(line)){fenced=!fenced;out.push(line.trimEnd());continue;}if(fenced){out.push(line);continue;}line=line.replace(emoji,'').replace(namedEmoji,'').replace(/[\u200B-\u200D\uFEFF\uFE0E\uFE0F]/g,'').replace(/\u00A0/g,' ').replace(/[ \t]+$/g,'');if(line.trim())out.push(line);}return out.join('\n').trim();
}
export function decorativeImage(url,alt=''){
 return /(?:^|[\s_/-])(?:emoji|emoticon|emotion|avatar|favicon)(?:[\s_/.?-]|$)|\/release\/blogv2\/dist\/.*\/img\/|picasso-static\.xiaohongshu\.com|sns-avatar[^/]*\.xhscdn\.com/i.test(url+' '+alt);
}
export function imageIdentity(url){try{const u=new URL(url);return u.hostname.endsWith('xhscdn.com')?u.hostname+u.pathname.split('!')[0]:u.hostname+u.pathname+u.search;}catch{return url;}}
export function sourceSignature(item){return digest(JSON.stringify([item.kind,item.kind==='video'?item.transcript:item.body,item.contentBlocks||null,item.imageUrls||item.images||[]]));}
export function prepareKnowledge(item){
 const signature=sourceSignature(item);if(item.knowledge?.version===KNOWLEDGE_VERSION&&item.knowledge.sourceSignature===signature)return item.knowledge;
 const old=new Map((item.knowledge?.blocks||[]).filter(b=>b.type==='image').map(b=>[imageIdentity(b.url),b]));
 let source=item.kind==='video'?[{type:'text',text:item.transcript||'',placement:'transcript'}]:item.contentBlocks?.length?item.contentBlocks:[{type:'text',text:item.body||item.transcript||'',placement:'legacy_text'},...(item.imageUrls||item.images||[]).map(url=>({type:'image',url,placement:'unknown_legacy'}))];
 const seen=new Set();let removedImages=0,removedCharacters=0,imageNo=0;
 const httpsVariants=new Map(source.filter(b=>b.type==='image'&&b.url?.startsWith('https:')).map(b=>[imageIdentity(b.url),b.url]));
 const blocks=source.flatMap((original,index)=>{const b={...original};if(b.type!=='image'){const text=cleanText(b.text);removedCharacters+=String(b.text||'').length-text.length;return text?[{...b,id:b.id||'text-'+index,text}]:[];}
  if(!/^https?:\/\//i.test(b.url||'')||decorativeImage(b.url,b.alt)){removedImages++;return[];}const key=imageIdentity(b.url);if(seen.has(key)&&b.placement!=='inline_dom'){removedImages++;return[];}seen.add(key);b.url=httpsVariants.get(key)||b.url;
  const cached=old.get(key);return[{...b,...(cached?{status:cached.status,description:cached.description,extractedText:cached.extractedText,caveats:cached.caveats,model:cached.model,contentHash:cached.contentHash,processedAt:cached.processedAt,error:cached.error}:{}),id:b.id||'image-'+(++imageNo),status:cached?.status==='processing'?'pending':cached?.status||'pending'}];
 });
 const k={version:KNOWLEDGE_VERSION,sourceSignature:signature,blocks,cleanedAt:new Date().toISOString(),stats:{rawCharacters:String(item.kind==='video'?item.transcript||'':item.body||'').length,removedCharacters,removedImages},positionStatus:blocks.some(b=>b.type==='image'&&['unknown_legacy','gallery_order_only'].includes(b.placement))?'unknown_legacy':'recorded'};
 return finalizeKnowledge(k);
}
export function finalizeKnowledge(k){
 const imgs=k.blocks.filter(b=>b.type==='image'),completed=imgs.filter(b=>['completed','decorative'].includes(b.status)).length;
 k.imageStats={total:imgs.length,completed,pending:imgs.filter(b=>['pending','processing'].includes(b.status)).length,failed:imgs.filter(b=>b.status==='failed'||b.status==='unreadable').length};
 k.status=!imgs.length?'cleaned':completed===imgs.length?'completed':k.imageStats.pending?'pending_images':'partial_images';
 const parts=[];let cursor=0;for(const b of k.blocks){const text=b.type==='image'?b.status==='completed'?`【图片信息${['unknown_legacy','gallery_order_only'].includes(b.placement)?'（原文段落位置未记录，附录）':''} · ${b.id} · 模型识别，需核对】\n${b.description}${b.extractedText?'\n图中文字：'+b.extractedText:''}${b.caveats?'\n识别限制：'+b.caveats:''}`:'':b.text;delete b.textStart;delete b.textEnd;if(!text)continue;if(parts.length)cursor++;b.textStart=cursor;cursor+=text.length;b.textEnd=cursor;parts.push(text);}k.text=parts.join('\n');k.stats.cleanCharacters=k.text.length;return k;
}
