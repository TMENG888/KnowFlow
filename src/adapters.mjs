import {canonical,parseCount,contentHash} from './domain.mjs';
import {Observer,walk,AccessError} from './browser.mjs';
import {PLATFORMS} from './config.mjs';
import {douyinSearchCards} from './douyin-ui.mjs';
const mediaUrl=v=>typeof v==='string'?v:(v?.url_list||v?.urlList||[]).find(u=>u.startsWith('https://'))||v?.url||null;
const iso=v=>{if(v==null)return null;const d=new Date(typeof v==='number'?(v<1e12?v*1000:v):v);return Number.isNaN(+d)?String(v):d.toISOString();};
export function fromObserved(platform,raw){
 if(platform==='douyin'){
  const images=(raw.images||raw.image_post_info?.images||[]).map(x=>mediaUrl(x.display_image||x)).filter(Boolean),s=raw.statistics||{};
  const videoUrls=[...new Set([...(raw.video?.play_addr?.url_list||[]),...(raw.video?.play_addr_h264?.url_list||[]),...(raw.video?.bit_rate||[]).flatMap(v=>v.play_addr?.url_list||[])].filter(u=>/^https?:/.test(u)))];
  return{sourceId:String(raw.aweme_id),title:String(raw.preview_title||raw.desc||'').split('\n')[0],body:raw.desc||'',kind:images.length?'image':'video',images,author:raw.author?.nickname||null,publishedAt:iso(raw.create_time),durationSeconds:Number(raw.video?.duration||raw.duration)/1000||null,mediaUrl:videoUrls[0]||null,videoUrls,metrics:{likes:parseCount(s.digg_count),comments:parseCount(s.comment_count),favorites:parseCount(s.collect_count),shares:parseCount(s.share_count),views:parseCount(s.play_count)}};
 }
 if(platform==='xiaohongshu'){
  const s=raw.interactInfo||raw.interact_info||{};let v2=raw.video?.mediaV2||{};if(typeof v2==='string')try{v2=JSON.parse(v2);}catch{v2={};}
  const streams=Object.values(raw.video?.media?.stream||v2.stream||{}).flat().filter(v=>v&&typeof v==='object');
  const stream=streams.find(v=>String(v.format).toLowerCase()==='mp4'&&Number(v.audioChannels??v.audio_channels??v.audioBitrate??v.audio_bitrate)>0)||streams.find(v=>String(v.format).toLowerCase()==='mp4')||streams.find(v=>v.masterUrl||v.master_url);
  const urls=streams.map(v=>v.masterUrl||v.master_url).filter(u=>/^https?:/.test(u||''));const media=stream?.masterUrl||stream?.master_url||null;
  return{sourceId:String(raw.noteId||raw.note_id),title:raw.title||'',body:raw.desc||'',kind:raw.type==='video'?'video':'image',images:(raw.imageList||raw.image_list||[]).map(i=>i.urlDefault||i.url_default||i.urlPre||i.url).filter(Boolean),author:raw.user?.nickname||null,publishedAt:iso(raw.time),durationSeconds:Number(raw.video?.capa?.duration||raw.video?.duration||raw.video?.media?.video?.duration)||null,mediaUrl:media,videoUrls:urls,metrics:{likes:parseCount(s.likedCount??s.liked_count),comments:parseCount(s.commentCount??s.comment_count),favorites:parseCount(s.collectedCount??s.collected_count),shares:parseCount(s.shareCount??s.share_count),views:null}};
 }
 if(platform==='zhihu')return{sourceId:(raw.type==='answer'?'answer-':'article-')+raw.id,title:raw.title||raw.question?.title||'',author:raw.author?.name||null,publishedAt:iso(raw.created_time||raw.created),metrics:{likes:parseCount(raw.voteup_count??raw.voteupCount),comments:parseCount(raw.comment_count??raw.commentCount),favorites:parseCount(raw.favlists_count),shares:null,views:null}};
 return{};
}
export async function extractDetail(page,platform,candidate,browser,{openedObserver=null,alreadyOpened=false}={}){
 if(!alreadyOpened)throw new Error('UI_CLICK_REQUIRED：详情必须从实际搜索结果点击打开');
 const observer=openedObserver||new Observer(page,platform);
 try{
  await browser.gate(page);
  // Use only the ordinary page's own expand control. Paywalls and verification
  // remain protected, and no private signed API is called.
  if(platform==='zhihu'){
   const expand=page.getByRole('button',{name:/^(展开阅读全文|阅读全文|显示全部)$/}).first();if(await expand.isVisible().catch(()=>false))await expand.click();
  }
  await page.waitForTimeout(1200);await observer.flush();
  if(platform==='douyin'&&candidate.inlineCard){const current=canonical(platform,page.url());if(current&&current.id!==candidate.id)throw new Error('SOURCE_ID_UNCONFIRMED：读取时详情浮层已切换到另一视频');const active=(await douyinSearchCards(page,{activeOnly:true})).find(c=>c.id===candidate.id);if(!active)throw new Error('SOURCE_ID_UNCONFIRMED：读取时活动视频已变化');candidate={...candidate,raw:active.raw||candidate.raw};}
  const dom=await page.evaluate(({platform,sourceId,inlineCard})=>{
   const scope=platform==='douyin'&&inlineCard?document.querySelector(`[data-e2e="feed-active-video"][data-e2e-vid="${sourceId}"]`):document;
   if(!scope)throw new Error('SOURCE_ID_UNCONFIRMED');
   const text=(selectors)=>{for(const sel of selectors.split('|')){const n=(platform==='douyin'?scope:document).querySelector(sel);if(n&&n.innerText?.trim())return n.innerText.trim();}return'';};
   const attr=(sel,name='content')=>document.querySelector(sel)?.getAttribute(name)||null;
   const selectors={csdn:'#content_views|#article_content',toutiao:'article .article-content|.article-content|article',zhihu:'.AnswerItem .RichContent-inner .RichText|.Post-RichTextContainer .RichText|.Post-RichTextContainer|.AnswerItem .RichContent-inner',xiaohongshu:'#detail-desc|.note-content .desc|.note-container .desc',douyin:'[data-e2e="video-desc"]|[data-e2e="detail-video-desc"]'};
   let node;for(const s of selectors[platform].split('|')){node=(platform==='douyin'?scope:document).querySelector(s);if(node)break;}
   const body=node?.innerText?.trim()||'';
   const title=text('h1.title-article|h1.QuestionHeader-title|h1.Post-Title|#detail-title|h1')||attr('meta[property="og:title"]')||document.title.replace(/\s*[-_]\s*(今日头条|CSDN博客|知乎).*$/,'');
   const videos=[...scope.querySelectorAll('video')].map(v=>({url:v.currentSrc||v.src||v.querySelector('source')?.src,duration:Number.isFinite(v.duration)?v.duration:null,tracks:[...v.querySelectorAll('track')].map(t=>({url:t.src,kind:t.kind,lang:t.srclang})),textTracks:[...v.textTracks].map(t=>({kind:t.kind,lang:t.language,cues:t.cues?[...t.cues].map(c=>({start:c.startTime,end:c.endTime,text:c.text})):[]}))}));
   const imageRoot=platform==='xiaohongshu'?(document.querySelector('#noteContainer,.note-container')||node):node;
   const images=imageRoot?[...imageRoot.querySelectorAll('img')].filter(i=>!i.closest('.author,.author-container,.avatar,.comments-container')).map(i=>i.getAttribute('data-original')||i.getAttribute('data-src')||i.currentSrc||i.src).filter(u=>/^https?:/.test(u)):[];
   const initial=[];
   if(platform==='xiaohongshu'&&window.__INITIAL_STATE__)try{initial.push(JSON.parse(JSON.stringify(window.__INITIAL_STATE__)));}catch{}
   if(platform!=='douyin')for(const s of document.querySelectorAll('script#__NEXT_DATA__,script#js-initialData,script#RENDER_DATA,script[type="application/ld+json"]')){if(s.textContent.length>3e6)continue;try{initial.push(JSON.parse(s.id==='RENDER_DATA'?decodeURIComponent(s.textContent):s.textContent));}catch{}}
   const pageHeader=platform==='douyin'?'':document.body.innerText.slice(0,2400);
   const counts=platform==='csdn'?{likes:text('#sidebar-like|#blog-digg-num|#is-like .num|.toolbox-middle .tool-item .like-count'),comments:text('#commentCount|.comment-count|.toolbox-comment .num|.comment-side-tit-count'),favorites:text('#sidebar-collect|.toolbox-collect .num|#blog-collect-num|.collect-count'),views:text('.read-count|.article-read-box .read-count')||pageHeader.match(/\d+(?:\.\d+)?\s*(?:万|千|[kKwW])?\s*阅读/)?.[0]||'',shares:''}:platform==='xiaohongshu'?{likes:text('.engage-bar-container .like-wrapper .count'),comments:text('.engage-bar-container .chat-wrapper .count'),favorites:text('.engage-bar-container .collect-wrapper .count'),shares:text('.engage-bar-container .share-wrapper .count')}:platform==='zhihu'?{likes:text('.VoteButton--up'),comments:text('.ContentItem-actions button:nth-child(2)'),favorites:'',shares:''}:{};
   if(platform==='douyin')for(const [key,selector]of Object.entries({likes:'video-player-digg',comments:'feed-comment-icon',favorites:'video-player-collect',shares:'video-player-share'}))counts[key]=text(`[data-e2e="${selector}"]`);
   const actionLabels=[...scope.querySelectorAll('button,[role="button"],.article-action,.article-interaction,.detail-article-action,.article-toolbox,[class*="digg"],[class*="comment-count"],[class*="favorite"],[class*="collect"]')].map(n=>({text:n.innerText?.trim().slice(0,100),aria:n.getAttribute('aria-label'),title:n.getAttribute('title')})).filter(x=>x.text||x.aria||x.title).slice(0,150);
   const paywall=[...document.querySelectorAll('.hide-article-box,.vip-article-mask,.ReadMore,.PurchaseButton,.simple-vip-paywall')].some(n=>n.getBoundingClientRect().height>0&&/会员|订阅|付费|购买|VIP|解锁文章|登录.*阅读/i.test(n.innerText))||!!document.querySelector('.is-paywall-clipped');
   return{title:title.replace(/^展开\s*/,''),body,images,videos,initial,counts,actionLabels,paywall,publishedAt:attr('meta[property="article:published_time"],meta[itemprop="datePublished"]')||text('.article-info-box .time|.ContentItem-time|.article-meta .time|.bottom-container .date')||pageHeader.match(/20\d{2}[-年]\d{1,2}[-月]\d{1,2}日?\s+\d{1,2}:\d{2}(?::\d{2})?/)?.[0]||null,author:text('.article-info-box .follow-nickName|.AuthorInfo-name|.author-container .name|.article-meta .name')||pageHeader.match(/20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}[^·\n]*·([^\n]+)/)?.[1]||null,description:attr('meta[name="description"]')||'',url:location.href};
  },{platform,sourceId:candidate.id,inlineCard:candidate.inlineCard});
  if(dom.paywall)throw new AccessError({code:'access_denied',scope:'item',message:'该篇正文仍被付费或会员限制截断，未计入完整正文；正常返回列表查找其他内容'});
  const rawNodes=[...observer.entities];for(const initial of dom.initial)walk(initial,v=>{
   if(platform==='xiaohongshu'&&String(v.noteId||v.note_id||'')===candidate.id&&v.desc!=null)rawNodes.push(v);
   if(platform==='douyin'&&String(v.aweme_id||'')===candidate.id&&v.desc!=null)rawNodes.push(v);
   if(platform==='zhihu'&&String(v.id||'')===candidate.id.replace(/^(answer|article)-/,''))rawNodes.push(v);
  });
  const raw=rawNodes.findLast(v=>String(v.aweme_id||v.noteId||v.note_id||v.id||'')===candidate.id.replace(/^(answer|article)-/,''))||candidate.raw;
  const observed=raw?fromObserved(platform,raw):{};
  const kind=observed.kind||(dom.videos.length||/\/video\//.test(dom.url)?'video':dom.images.length?'image':'article');
  const metrics={likes:null,comments:null,favorites:null,shares:null,views:null,...observed.metrics};
  for(const key of Object.keys(metrics))if(metrics[key]==null)metrics[key]=parseCount(dom.counts[key]);
  const labels={likes:/点赞|赞同|^赞/,comments:/评论/,favorites:/收藏/,shares:/转发|分享/,views:/阅读|播放|浏览/};
  for(const [key,re]of Object.entries(labels))if(metrics[key]==null){const label=dom.actionLabels.find(l=>re.test([l.text,l.aria,l.title].join(' '))&&/\d/.test([l.text,l.aria,l.title].join(' ')));if(label)metrics[key]=parseCount(label.text+' '+(label.aria||'')+' '+(label.title||''));}
  const item={platform,sourceId:candidate.id,url:canonical(platform,dom.url)?.url||candidate.url,title:(platform==='douyin'?(observed.title||candidate.title||dom.title):(dom.title||observed.title||candidate.title))||'',body:(platform==='douyin'?(observed.body||dom.body):(dom.body||observed.body))||'',summary:candidate.summary||dom.description||'',author:observed.author||dom.author||null,publishedAt:observed.publishedAt||dom.publishedAt||null,kind,images:[...new Set([...(observed.images||[]),...dom.images])],metrics,metricSource:raw?.pageStateSource?'rendered_card_state_and_dom':raw?'browser_response_and_dom':'visible_dom',mediaUrl:dom.videos.find(v=>/^https?:/.test(v.url||''))?.url||observed.mediaUrl||null,durationSeconds:dom.videos.find(v=>v.duration)?.duration||observed.durationSeconds||null,captions:dom.videos.flatMap(v=>v.textTracks.flatMap(t=>t.cues)),captionTracks:dom.videos.flatMap(v=>v.tracks),transcript:null,transcriptStatus:kind==='video'?'pending':'not_applicable',collectedAt:new Date().toISOString(),extractionVersion:'playwright-dom-response-v2'};
  if(kind!=='video'&&item.body.replace(/\s/g,'').length<25)throw new Error('DETAIL_CONTENT_MISSING：详情正文不足，搜索摘要未计入正文');
  item.imageUrls=[...item.images];item.videoUrls=[...new Set([item.mediaUrl,...(observed.videoUrls||[]),...dom.videos.map(v=>v.url)].filter(u=>/^https?:/.test(u||'')))];item.videoUrl=item.videoUrls[0]||null;item.resourceLinksObservedAt=item.collectedAt;item.videoUrlMayExpire=item.videoUrls.length>0;
  item.contentHash=contentHash(item.body);return item;
 }finally{if(!openedObserver)observer.close();}
}
