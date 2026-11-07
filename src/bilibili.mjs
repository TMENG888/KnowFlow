import {canonical,parseCount,contentHash} from './domain.mjs';
import {Observer,AccessError} from './browser.mjs';
const url=value=>typeof value==='string'&&/^https?:\/\//.test(value)?value:typeof value==='string'&&value.startsWith('//')?'https:'+value:null;
export function bilibiliItem({candidate,video,playback={},dom={}}){
 const source=canonical('bilibili',dom.url||candidate.url);
 if(!source||source.id!==candidate.id||video?.bvid!==source.bvid)throw new Error('SOURCE_ID_UNCONFIRMED：B站当前视频与搜索卡片不一致');
 const part=(video.pages||[]).find(p=>Number(p.page)===source.part);
 if(!part?.cid)throw new Error('BILIBILI_PART_UNCONFIRMED：当前P未核实，不展开遍历合集');
 if(playback.is_preview||playback.isPreview||video.is_upower_exclusive||video.rights?.pay)throw new AccessError({code:'access_denied',scope:'item',message:'B站当前视频为预览或付费受限，未计入完整视频'});
 const audioUrls=[...new Set((playback.dash?.audio||[]).flatMap(a=>[a.baseUrl,a.base_url,...(a.backupUrl||a.backup_url||[])]).map(url).filter(Boolean))];
 const progressive=playback.durl||[];
 const videoUrls=[...new Set([...(playback.dash?.video||[]).flatMap(v=>[v.baseUrl,v.base_url,...(v.backupUrl||v.backup_url||[])]),...progressive.flatMap(v=>[v.url,...(v.backup_url||[])])].map(url).filter(Boolean))];
 // A multipart progressive response must not be mistaken for a whole video.
 const mediaUrl=audioUrls[0]||(progressive.length===1?url(progressive[0].url):null);
 const stat=video.stat||{},images=[...new Set([video.pic,...(dom.images||[])].map(url).filter(Boolean))];
 const collectedAt=new Date().toISOString();
 const item={platform:'bilibili',sourceId:source.id,bvid:source.bvid,cid:String(part.cid),part:source.part,
  url:source.url,title:video.title||dom.title||'',partTitle:part.part||null,
  body:dom.description||video.desc||'',author:video.owner?.name||null,
  publishedAt:video.pubdate?new Date(video.pubdate*1000).toISOString():null,kind:'video',images,imageUrls:images,
  durationSeconds:Number(part.duration)||null,mediaUrl,audioUrls,asrMediaKind:audioUrls.length?'audio':'video',
  videoUrls,videoUrl:videoUrls[0]||null,videoUrlMayExpire:videoUrls.length>0,resourceLinksObservedAt:collectedAt,
  metrics:{likes:parseCount(stat.like),comments:parseCount(stat.reply),favorites:parseCount(stat.favorite),shares:parseCount(stat.share),views:parseCount(stat.view)},
  metricsExtra:{coins:parseCount(stat.coin),danmaku:parseCount(stat.danmaku)},metricSource:'browser_page_video_state',
  collectedAt,transcript:null,transcriptStatus:'pending',extractionVersion:'bilibili-single-result-v1',
  collectionScope:{mode:'clicked_result_only',selectedPart:source.part,totalParts:Number(video.videos)||video.pages?.length||null,seriesExpanded:false}};
 item.contentHash=contentHash(item.body);return item;
}
export async function extractBilibili(page,candidate,browser,{openedObserver=null}={}){
 const observer=openedObserver||new Observer(page,'bilibili');
 try{
  await browser.gate(page);await page.waitForTimeout(1500);await observer.flush();
  const dom=await page.evaluate(()=>{
   const initial=window.__INITIAL_STATE__||{};const video=initial.videoData||initial.videoInfo||null;
   // Whitelist public video metadata; no cookies, credentials or user profile.
   const selected=video?Object.fromEntries(['bvid','aid','cid','title','desc','pic','owner','pubdate','stat','pages','videos','rights','is_upower_exclusive'].map(k=>[k,video[k]])):null;
   const info=window.__playinfo__?.data;
   return{url:location.href,title:document.querySelector('h1')?.innerText||document.title,description:document.querySelector('#v_desc .basic-desc-info,#v_desc .desc-info-text,.video-desc-container .basic-desc-info')?.innerText||'',video:selected,playback:info?{dash:info.dash,durl:info.durl,is_preview:info.is_preview,isPreview:info.isPreview}:null,images:[],visibleDuration:document.querySelector('video')?.duration||null};
  });
  if(!dom.video)throw new Error('BILIBILI_VIDEO_STATE_MISSING：尚未读取到当前视频元数据');
  const selected=(dom.video.pages||[]).find(p=>Number(p.page)===(candidate.part||1));
  const observed=observer.playbacks.findLast(p=>String(p.cid)===String(selected?.cid)&&(!p.bvid||p.bvid===candidate.bvid));
  if((candidate.part||1)>1&&!observed)throw new Error('BILIBILI_PART_PLAYBACK_UNCONFIRMED：尚未核实当前P播放响应，未复用其他P音轨');
  return bilibiliItem({candidate,video:dom.video,playback:observed?.data||dom.playback||{},dom});
 }finally{if(!openedObserver)observer.close();}
}
