// Only inspect content attached to rendered search cards. The player uses a
// MediaStream, so an empty <video src> does not imply that media is unavailable.
// The allowlist deliberately excludes account state, tokens and private panels.
export const DOUYIN_FEED='[data-e2e="scroll-list"] .search-result-card [data-e2e-vid]';
export async function douyinSearchCards(page,{activeOnly=false}={}){
 return page.locator(DOUYIN_FEED).evaluateAll((nodes,{activeOnly})=>{
  const urls=value=>{
   if(typeof value==='string')return /^https?:/.test(value)?[value]:[];
   if(Array.isArray(value))return value.flatMap(urls);
   return value&&typeof value==='object'?urls(value.src||value.url||value.urlList||value.url_list):[];
  };
  const unique=a=>[...new Set(a)];
  return nodes.filter(n=>n.getClientRects().length&&(!activeOnly||n.dataset.e2e==='feed-active-video')).map(n=>{
   const id=n.getAttribute('data-e2e-vid');if(!/^\d+$/.test(id||''))return null;
   const card=n.closest('.search-result-card'),fiberKey=Object.keys(n).find(k=>k.startsWith('__reactFiber$'));
   let f=n[fiberKey],item=null;
   for(let depth=0;f&&depth<18;depth++,f=f.return){const p=f.memoizedProps||{};for(const v of [p.item,p.data?.awemeInfo])if(String(v?.awemeId||v?.aweme_id||'')===id){item=v;break;}if(item)break;}
   let raw=null;
   if(item){
    const v=item.video||{},s=item.stats||item.statistics||{};
    const media=unique([...urls(v.playAddr),...urls(v.play_addr),...urls(v.play_addr_h264),...urls(v.playAddrH265),...(v.bitRateList||v.bit_rate||[]).flatMap(b=>urls(b.playAddr||b.play_addr||b.urlList))]).filter(u=>!new URL(u).pathname.startsWith('/aweme/'));
    raw={aweme_id:id,desc:item.desc||'',preview_title:item.itemTitle||item.desc||'',create_time:item.createTime||item.create_time||null,author:{nickname:item.authorInfo?.nickname||item.author?.nickname||null},statistics:{digg_count:s.diggCount??s.digg_count,comment_count:s.commentCount??s.comment_count,collect_count:s.collectCount??s.collect_count,share_count:s.shareCount??s.share_count},video:{duration:v.duration||null,play_addr:{url_list:media}},images:(item.images||[]).map(i=>({url_list:urls(i.displayImage||i.display_image||i)})),pageStateSource:'rendered_search_card'};
   }
   const description=card.querySelector('[data-e2e="video-desc"],[data-e2e="detail-video-desc"]')?.innerText?.trim();
   return {id,url:'https://www.douyin.com/video/'+id,title:raw?.preview_title||description||card.innerText.trim().slice(0,250),summary:'',inlineCard:true,raw,active:n.dataset.e2e==='feed-active-video'};
  }).filter(Boolean);
 },{activeOnly});
}
