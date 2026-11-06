import {randomInt} from 'node:crypto';
import {createHash} from 'node:crypto';
import {canonical} from './domain.mjs';
import {config,PLATFORMS} from './config.mjs';
import {Observer} from './browser.mjs';
import {douyinSearchCards,DOUYIN_FEED} from './douyin-ui.mjs';
export const DEFAULT_PACING={action:[1500,3200],read:[2500,4800],scroll:[1100,2300],key:[40,110]};
export function randomDelayRange(kind,policy=config.pacing||DEFAULT_PACING){const pair=policy[kind]||DEFAULT_PACING[kind]||DEFAULT_PACING.action;const low=Math.max(0,Math.floor(pair[0])),high=Math.max(low,Math.floor(pair[1]));return randomInt(low,high+1);}
export async function pace(page,kind,signal,log=()=>{}){if(signal?.aborted)throw new Error('STOP_REQUESTED');const ms=randomDelayRange(kind);log(`自然操作间隔 ${ms}ms`,{action:'pacing',kind,ms});await page.waitForTimeout(ms);if(signal?.aborted)throw new Error('STOP_REQUESTED');return ms;}
const INPUTS={
 douyin:['[data-e2e="searchbar-input"]','input[name="keyword"]','input[placeholder*="搜索"]'],
 xiaohongshu:['textarea#search-input-in-feeds','input#search-input','textarea#search-input-ai','.search-input input','input[placeholder*="搜索"]','input[placeholder*="登录探索"]'],
 zhihu:['.SearchBar-input input','input.SearchBar-input','input[placeholder*="搜索"]','input[role="combobox"]'],
 toutiao:['input[name="keyword"]','input[placeholder*="搜索"]','input[type="search"]','input[type="text"]'],
 csdn:['#toolbar-search-input','input[name="q"]','input[placeholder*="搜索"]','input[placeholder*="搜"]']
};
async function visibleControl(page,selectors){for(const selector of selectors){const group=page.locator(selector);for(let i=0;i<await group.count();i++)if(await group.nth(i).isVisible()&&await group.nth(i).isEnabled())return group.nth(i);}return null;}
export async function closeOverlay(page,platform){
 const selectors=platform==='xiaohongshu'?['.note-detail-mask .close.close-mask-dark','.note-detail-mask .close','.close.close-mask-dark']:platform==='douyin'?['[data-e2e="close-icon"]','[data-e2e="detail-close"]',...(new URL(page.url()).searchParams.has('modal_id')?['.o7hAjQkB.isDark']:[]),'button[aria-label="关闭"]','.dy-account-close']:['button[aria-label="关闭详情"]'];
 const close=await visibleControl(page,selectors);if(close){await close.click({timeout:8000});await page.waitForTimeout(1000);return true;}return false;
}
export async function startUiSearch(page,platform,keyword,browser,{signal,log=()=>{}}={}){
 // Only the public homepage is bootstrapped. Search/detail URLs are never
 // constructed for navigation: every search comes from the visible input.
 let belongs=false;try{const h=new URL(page.url()).hostname;belongs=PLATFORMS[platform].hosts.some(v=>h===v||h.endsWith('.'+v));}catch{}
 if(!belongs){log('打开平台首页',{action:'home'});await browser.navigate(page,PLATFORMS[platform].home);}
 await browser.gate(page);await closeOverlay(page,platform);await pace(page,'action',signal,log);
 let input=await visibleControl(page,INPUTS[platform]);
 if(!input&&platform==='xiaohongshu'){
  const searchIcon=await visibleControl(page,['button.min-width-search-icon']);
  if(searchIcon){await searchIcon.click();log('点击窄窗口搜索入口展开输入框',{action:'open_search_control'});await pace(page,'action',signal,log);}
 }
 for(let i=0;!input&&i<20;i++){await page.waitForTimeout(400);if(signal?.aborted)throw new Error('STOP_REQUESTED');input=await visibleControl(page,INPUTS[platform]);if(i%5===0)await browser.gate(page);}
 if(!input)throw new Error('SEARCH_INPUT_NOT_FOUND：没有找到唯一可用的搜索输入框，保留页面，不直达检索链接');
 await input.click();await input.press('Control+A');await input.press('Backspace');
 for(const char of keyword){if(signal?.aborted)throw new Error('STOP_REQUESTED');await input.pressSequentially(char,{delay:randomDelayRange('key')});}
 if(await input.inputValue()!==keyword)throw new Error('SEARCH_INPUT_MISMATCH：输入框内容与原检索词不符');
 log('已逐字输入原检索词',{action:'type_query',keyword});await pace(page,'action',signal,log);
 let popup=null;const onPage=p=>{popup=p;};page.on('popup',onPage);
 try{const modern=platform==='xiaohongshu'?await visibleControl(page,['.textarea-container .bottom-box-right .submit-button-wrapper']):null;const button=page.getByRole('button',{name:'搜索',exact:true}).first();if(modern)await modern.click({timeout:8000});else if(await button.isVisible().catch(()=>false))await button.click({timeout:8000});else await input.press('Enter');log('通过搜索控件提交检索',{action:'submit_search',keyword});await page.waitForTimeout(2200);}finally{page.off('popup',onPage);}
 if(popup){await popup.waitForLoadState('domcontentloaded',{timeout:config.navigationTimeoutMs}).catch(()=>{});await browser.gate(popup);if(!searchKeywordMatches(popup.url(),keyword))throw new Error('SEARCH_CONTEXT_UNVERIFIED：新搜索页未确认原检索词');return popup;}
 await browser.gate(page);if(!searchKeywordMatches(page.url(),keyword))throw new Error('SEARCH_CONTEXT_UNVERIFIED：搜索页未确认原检索词');return page;
}
export function searchKeywordMatches(url,keyword){try{const u=new URL(url);const route=u.pathname.match(/\/(?:jingxuan\/)?search\/(.+)$/);let value=u.searchParams.get('keyword')??u.searchParams.get('q')??(route?decodeURIComponent(route[1]):null);for(let i=0;i<3&&value!=null;i++){if(value===keyword)return true;const next=decodeURIComponent(value);if(next===value)break;value=next;}return false;}catch{return false;}}
export async function visibleCandidates(page,platform,observer){
 await observer.flush();
 if(platform==='douyin'){for(let attempt=0;attempt<12;attempt++){const inline=await douyinSearchCards(page);if(inline.length)return inline;if(!await page.locator('.search-result-card').count())break;await page.waitForTimeout(500);}}
 const selector=platform==='toutiao'?'.cs-header a[href]':platform==='zhihu'?'.Search-container .List-item .ContentItem-title a[href],.SearchResult-Card .ContentItem-title a[href]':'a[href]';
 const links=await page.locator(selector).evaluateAll(ns=>ns.map(n=>({url:n.href,title:n.innerText?.trim().slice(0,250)||'',visible:!!n.getClientRects().length,summary:n.closest('section,.SearchResult-Card,.search-result-card,.csdn-tracking-statistics,.note-item,.cs-card-content')?.innerText?.slice(0,900)||''})).filter(n=>n.visible));
 const map=new Map();for(const link of links){const c=canonical(platform,link.url);if(!c)continue;let found=map.get(c.id);if(!found)map.set(c.id,{...c,title:link.title,summary:link.summary,clickHref:link.url});else if(!found.title&&link.title){found.title=link.title;found.clickHref=link.url;}}
 // IDs from unrelated home feeds or invisible response records never become
 // clickable candidates. A current rendered result card must exist.
 for(const candidate of map.values())candidate.raw=observer.entities.findLast(v=>String(v.aweme_id||v.noteId||v.note_id||v.id||'')===candidate.id.replace(/^(answer|article)-/,''));
 if(platform==='douyin'&&!map.size){
  const cards=await page.locator('.search-result-card div:has(> .videoImage)').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>({title:n.querySelector('.hu36PKCP')?.innerText?.trim()||n.innerText.trim(),poster:n.querySelector('img')?.src||''})).filter(n=>n.title));
  for(const card of cards){const raw=observer.entities.findLast(v=>v.aweme_id&&String(v.desc||'').trim()===card.title.trim());const id=raw?String(raw.aweme_id):'ui-card:'+createHash('sha256').update(card.title+'|'+card.poster.split('?')[0]).digest('hex').slice(0,20);map.set(id,{id,title:card.title,summary:'',uiCard:true,poster:card.poster,raw});}
 }
 return[...map.values()].map(c=>platform==='zhihu'?{...c,resultScope:'primary_search_result'}:c);
}
export async function clickCandidate(search,platform,candidate,browser,{signal,log=()=>{}}={}){
 await browser.gate(search);const beforeUrl=search.url();
 if(platform==='douyin'&&candidate.inlineCard){
  const node=search.locator(DOUYIN_FEED+`[data-e2e-vid="${candidate.id}"]`).first();
  if(!await node.count())throw new Error('SEARCH_CARD_NOT_VISIBLE：搜索视频卡片已变化');
  await node.scrollIntoViewIfNeeded();await pace(search,'action',signal,log);
  const observer=new Observer(search,platform);
  try{
   // One ordinary player click starts or pauses playback; no URL is fabricated.
   const player=node.locator('.douyin-player-video-container').first();
   await (await player.count()?player:node).click({timeout:10000});
   log('点击搜索列表内的视频播放器',{action:'click_result',sourceId:candidate.id});
   await pace(search,'read',signal,log);await browser.gate(search);
   const actual=canonical(platform,search.url());
   if(actual&&actual.id!==candidate.id)throw new Error('SOURCE_ID_UNCONFIRMED：详情浮层来源与点击卡片不一致');
   const selected=(await douyinSearchCards(search,{activeOnly:true})).find(c=>c.id===candidate.id);
   if(!selected)throw new Error('SOURCE_ID_UNCONFIRMED：点击后活动播放器与搜索卡片ID不一致，保留现场');
   return {page:search,observer,search,beforeUrl,platform,candidate:selected,popup:false,mode:actual?'overlay':'inline'};
  }catch(e){observer.close();e.detailPage=search;throw e;}
 }
 const anchors=search.locator(candidate.uiCard?'.search-result-card div:has(> .videoImage)':'a[href]');let link=null;
 for(let i=0;i<await anchors.count();i++){
  const node=anchors.nth(i);if(!await node.isVisible())continue;
  if(candidate.uiCard){const title=await node.locator('.hu36PKCP').innerText().catch(()=>node.innerText());if(title.trim()===candidate.title){link=node;break;}continue;}
  const raw=await node.getAttribute('href');const absolute=raw?new URL(raw,search.url()).href:null;
  if(absolute===candidate.clickHref||(canonical(platform,absolute)?.id===candidate.id)){link=node;break;}
 }
 if(!link)throw new Error('SEARCH_CARD_NOT_VISIBLE：当前结果中未找到该内容的可见链接，不拼接详情URL');
 await link.scrollIntoViewIfNeeded();const box=await link.boundingBox();if(box)await search.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await pace(search,'action',signal,log);
 const context=search.context(),sameObserver=new Observer(search,platform);let popup=null,popupObserver=null;
 const newPage=p=>{popup=p;popupObserver=new Observer(p,platform);};search.on('popup',newPage);
 try{
  let clickTarget=link;if(candidate.uiCard){const cover=link.locator('.videoImage').first(),bounds=await cover.boundingBox();if(bounds?.height>10)clickTarget=cover;}
  await clickTarget.click({timeout:10000});log('点击搜索结果卡片',{action:'click_result',sourceId:candidate.id});await search.waitForTimeout(1800);
  const page=popup||search;await page.waitForLoadState('domcontentloaded',{timeout:config.navigationTimeoutMs}).catch(()=>{});await browser.gate(page);await pace(page,'read',signal,log);
  let resolved=candidate;
  if(candidate.uiCard){let actual;for(let i=0;i<12;i++){actual=canonical(platform,page.url());if(actual&&(candidate.raw?actual.id===String(candidate.raw.aweme_id):actual.id!==canonical(platform,beforeUrl)?.id))break;actual=null;await page.waitForTimeout(500);}if(!actual)throw new Error('SOURCE_ID_UNCONFIRMED：卡片已点击但详情未确认真实来源ID，保留现场，停止该平台连续点击');resolved={...candidate,...actual};}
  if(popup)sameObserver.close();return{page,observer:popupObserver||sameObserver,search,beforeUrl,platform,candidate:resolved,popup:!!popup,mode:popup?'new_tab':platform==='xiaohongshu'?'overlay':'same_tab'};
 }catch(e){sameObserver.close();popupObserver?.close();e.detailPage=popup||search;throw e;}finally{search.off('popup',newPage);}
}
export async function returnToResults(opened,browser,{signal,log=()=>{}}={}){
 const {page,search,platform,beforeUrl,popup}=opened;opened.observer.close();if(signal?.aborted)return;
 await pace(page,'action',signal,log);
 if(opened.mode==='inline'){await browser.gate(search);log('已在搜索列表内完成视频读取，继续下一条',{action:'return_to_results',method:'inline_list'});return;}
 if(popup){await page.close();log('关闭阅读页签回到搜索结果',{action:'return_to_results',method:'close_tab'});}
 else{
  const closed=await closeOverlay(page,platform);
  if(closed){log('点击详情关闭按钮回到搜索结果',{action:'return_to_results',method:'close_button'});if(platform==='douyin'&&canonical(platform,page.url()))throw new Error('DETAIL_CLOSE_NOT_FOUND：点击关闭后详情浮层仍存在，保留现场');}
  else if(page.url()!==beforeUrl){await page.goBack({waitUntil:'domcontentloaded',timeout:config.navigationTimeoutMs});log('使用浏览器返回回到搜索结果',{action:'return_to_results',method:'browser_back'});}
  else if(platform==='xiaohongshu')throw new Error('DETAIL_CLOSE_NOT_FOUND：未找到左上角关闭按钮，停止连续点击以保留现场');
 }
 await browser.gate(search);if(!/search/i.test(search.url()))throw new Error('SEARCH_CONTEXT_LOST：关闭详情后未回到搜索页面');
}
export async function readDetail(opened,browser,{signal,log=()=>{}}={}){
 const page=opened.page;await browser.gate(page);
 const roots={xiaohongshu:'#noteContainer,.note-container',douyin:'video,[data-e2e="video-desc"],[data-e2e="detail-video-desc"]',toutiao:'article,.article-content,video',zhihu:'.Post-RichTextContainer,.AnswerItem .RichContent-inner',csdn:'#content_views,#article_content'};
 const root=opened.mode==='inline'?page.locator(DOUYIN_FEED+`[data-e2e-vid="${opened.candidate.id}"]`).first():page.locator(roots[opened.platform]).filter({visible:true}).first();
 await root.waitFor({state:'visible',timeout:12000});
 let last=null,stable=0;
 for(let i=0;i<8;i++){
  if(signal?.aborted)throw new Error('STOP_REQUESTED');
  const current=await root.evaluate(n=>[n.innerText?.length||0,n.querySelectorAll('img').length,n.scrollHeight].join(':'));
  if(current===last)stable++;else stable=0;last=current;if(stable>=2)break;await page.waitForTimeout(400);
 }
 if(stable<2)throw new Error('DETAIL_NOT_STABLE：详情仍在变化，未将未稳定的正文计入完成');
 log('详情内容已出现并完成稳定性检查',{action:'detail_ready'});
 const bounds=await root.boundingBox(),viewport=page.viewportSize()||{width:1440,height:960};
 const scrollable=await root.evaluate(n=>{for(let e=n;e&&e!==document.body;e=e.parentElement){const style=getComputedStyle(e);if(/auto|scroll/.test(style.overflowY)&&e.scrollHeight>e.clientHeight+120)return true;}return n.getBoundingClientRect().height>innerHeight;});
 if(scrollable&&bounds&&opened.mode!=='inline'&&opened.platform!=='douyin'){
  await page.mouse.move(Math.min(viewport.width-40,bounds.x+bounds.width*.6),Math.max(90,Math.min(viewport.height*.6,bounds.y+220)));
  for(let step=0;step<Math.min(3,config.readScrollSteps??2);step++){await pace(page,'read',signal,log);await page.mouse.wheel(0,randomInt(280,481));log('在详情区分段滚动阅读',{action:'read_scroll',step:step+1});await pace(page,'scroll',signal,log);await browser.gate(page);}
 }
}
