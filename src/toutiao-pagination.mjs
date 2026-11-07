import {PLATFORMS,config} from './config.mjs';
import {pace,searchKeywordMatches} from './ui-navigation.mjs';

const NEXT=/^\s*(?:下一页|下页|next)(?:\s*[›»>→])?\s*$/i;
export async function toutiaoResultSnapshot(page){
 const links=await page.locator('.cs-header a[href]').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>[n.href,(n.innerText||'').trim()]));
 return{fingerprint:JSON.stringify(links),count:links.length};
}
export async function advanceToutiaoResults(page,browser,{keyword,signal,log=()=>{},visited=new Set(),timeoutMs=config.navigationTimeoutMs,pause=pace}={}){
 if(signal?.aborted)throw new Error('STOP_REQUESTED');
 if(!searchKeywordMatches(page.url(),keyword))throw new Error('SEARCH_CONTEXT_LOST：翻页前检索词不一致');
 await browser.gate(page);
 const controls=page.getByRole('link',{name:NEXT}).or(page.getByRole('button',{name:NEXT}));
 let next=null,disabled=false;
 for(let n=0;n<await controls.count();n++){
  const control=controls.nth(n);if(!await control.isVisible())continue;
  const unavailable=await control.evaluate(n=>n.getAttribute('aria-disabled')==='true'||n.hasAttribute('disabled')||/(^|\s)(?:disabled|is-disabled)(?:\s|$)/.test(n.className));
  if(unavailable||!await control.isEnabled()){disabled=true;continue;}
  const raw=await control.getAttribute('href');
  if(raw&&!raw.startsWith('#')&&!/^javascript:/i.test(raw)){
   const u=new URL(raw,page.url());
   if(!['http:','https:'].includes(u.protocol)||!PLATFORMS.toutiao.hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))||!searchKeywordMatches(u.href,keyword))continue;
  }
  next=control;break;
 }
 if(!next)return{advanced:false,reason:disabled?'next_disabled':'next_not_found'};
 const before=await toutiaoResultSnapshot(page),fromUrl=page.url();visited.add(before.fingerprint);
 await next.scrollIntoViewIfNeeded();await pause(page,'action',signal,log);
 if(signal?.aborted)throw new Error('STOP_REQUESTED');
 await next.click({timeout:Math.min(timeoutMs,10000)});
 log('点击头条搜索“下一页”',{action:'click_next_page',fromUrl});
 const deadline=Date.now()+timeoutMs;let changed=null,stable=0;
 while(Date.now()<deadline){
  if(signal?.aborted)throw new Error('STOP_REQUESTED');
  await page.waitForTimeout(400);
  let snapshot;
  try{snapshot=await toutiaoResultSnapshot(page);}catch(e){if(/Execution context was destroyed|Cannot find context/i.test(e.message))continue;throw e;}
  await browser.gate(page);
  if(!searchKeywordMatches(page.url(),keyword))throw new Error('SEARCH_CONTEXT_LOST：翻页后偏离原检索词');
  if(!snapshot.count||snapshot.fingerprint===before.fingerprint){stable=0;continue;}
  if(visited.has(snapshot.fingerprint))throw new Error('SEARCH_PAGINATION_LOOP：下一页重复已访问结果，保留断点');
  if(changed===snapshot.fingerprint)stable++;else{changed=snapshot.fingerprint;stable=0;}
  if(stable>=2){visited.add(snapshot.fingerprint);log('头条下一页结果已加载并稳定',{action:'next_page_ready',url:page.url(),renderedLinks:snapshot.count});return{advanced:true,url:page.url(),renderedLinks:snapshot.count};}
 }
 throw new Error('SEARCH_PAGINATION_STALLED：点击下一页后未确认新结果加载，保留断点');
}
