import test from 'node:test';
import assert from 'node:assert/strict';
import {getPlaywright} from '../src/config.mjs';
import {BrowserManager,Observer} from '../src/browser.mjs';
import {startUiSearch,visibleCandidates,clickCandidate,returnToResults,randomDelayRange,readDetail,searchKeywordMatches} from '../src/ui-navigation.mjs';
import {extractDetail} from '../src/adapters.mjs';
test('bounded pacing produces varied delays within configured limits',()=>{const values=new Set(Array.from({length:50},()=>randomDelayRange('action',{action:[10,100]})));assert.ok(values.size>1);assert.ok([...values].every(v=>v>=10&&v<=100));});
test('normal XHS double-encoded query matches original input, unrelated search never matches',()=>{const keyword='什么是React agent？';assert.equal(searchKeywordMatches('https://www.xiaohongshu.com/search_result_ai?keyword='+encodeURIComponent(encodeURIComponent(keyword)),keyword),true);assert.equal(searchKeywordMatches('https://www.xiaohongshu.com/search_result_ai?keyword='+encodeURIComponent('热门新闻'),keyword),false);});
test('Zhihu queue candidates contain primary search titles and exclude background recommendations or body links',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage(),observer=new Observer(page,'zhihu');
 try{await page.setContent('<h2 class="ContentItem-title"><a href="https://zhuanlan.zhihu.com/p/999">背景推荐</a></h2><div class="Search-container"><div class="List-item SearchResult-Card"><h2 class="ContentItem-title"><a href="https://zhuanlan.zhihu.com/p/111">ReAct Agent真实结果</a></h2><a href="https://zhuanlan.zhihu.com/p/222">摘要里的引用</a></div></div>');const candidates=await visibleCandidates(page,'zhihu',observer);assert.deepEqual(candidates.map(c=>c.id),['article-111']);assert.equal(candidates[0].resultScope,'primary_search_result');}finally{observer.close();await browser.close();}
});
test('actual browser types query, clicks overlay, captures media links, closes top-left and returns',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();const requests=[],actions=[];const id='666666666666666666666666';
 const html=`<!doctype html><html lang="zh-CN"><body><form id="form"><input id="search-input"><button>搜索</button></form><div id="results"></div><script>
 document.querySelector('#form').onsubmit=e=>{e.preventDefault();history.pushState({},'', '/search_result?keyword='+encodeURIComponent(document.querySelector('input').value));document.querySelector('#results').innerHTML='<section><a href="/explore/${id}?xsec_token=fixture" id="card">测试文章</a></section>';document.querySelector('#card').onclick=e=>{e.preventDefault();history.pushState({},'',e.currentTarget.href);const div=document.createElement('div');div.className='note-detail-mask';div.innerHTML='<button class="close close-mask-dark">×</button><div id="noteContainer"><h1 id="detail-title">测试详情</h1><div id="detail-desc">这是一段仅用于自动化测试的充分长正文，用来验证搜索点击和媒体链接字段，不会计入真实采集数据。</div><img src="https://example.invalid/fixture-image.jpg"></div>';document.body.append(div);div.querySelector('button').onclick=()=>{div.remove();history.back();};};};
 </script></body></html>`;
 await context.route('https://www.xiaohongshu.com/**',r=>{requests.push(r.request().url());return r.fulfill({status:200,contentType:'text/html',body:html});});await context.route('https://example.invalid/**',r=>r.fulfill({status:204,body:''}));
 const page=await context.newPage(),manager=new BrowserManager(),observer=new Observer(page,'xiaohongshu',{purpose:'search',keyword:'什么是React agent？'});
 try{
  await startUiSearch(page,'xiaohongshu','什么是React agent？',manager,{log:(m,e)=>actions.push(e)});const candidates=await visibleCandidates(page,'xiaohongshu',observer);assert.equal(candidates.length,1);
  const opened=await clickCandidate(page,'xiaohongshu',candidates[0],manager,{log:(m,e)=>actions.push(e)});assert.equal(opened.mode,'overlay');await readDetail(opened,manager,{log:(m,e)=>actions.push(e)});assert.ok(actions.some(a=>a.action==='detail_ready'));const item=await extractDetail(page,'xiaohongshu',candidates[0],manager,{alreadyOpened:true,openedObserver:opened.observer});assert.ok(item.body.length>25);assert.ok(item.imageUrls.includes('https://example.invalid/fixture-image.jpg'));assert.deepEqual(item.videoUrls,[]);
  await returnToResults(opened,manager,{log:(m,e)=>actions.push(e)});assert.equal(await page.locator('#noteContainer').count(),0);assert.ok(page.url().includes('/search_result?'));
  assert.equal(requests.filter(u=>new URL(u).pathname.startsWith('/explore/')).length,0,'no direct detail navigation was issued');assert.ok(actions.some(e=>e.action==='click_result'));assert.ok(actions.some(e=>e.method==='close_button'));
 }finally{observer.close();await browser.close();}
});
test('Toutiao candidates exclude hot board and external results; CSDN clipping never completes',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),manager=new BrowserManager();
 try{
  await page.setContent('<a href="https://www.toutiao.com/article/111/">热榜</a><div class="cs-header"><a href="https://www.toutiao.com/article/222/">真正检索结果</a><a href="https://juejin.cn/post/333">外站</a></div>');
  const observer=new Observer(page,'toutiao');assert.deepEqual((await visibleCandidates(page,'toutiao',observer)).map(c=>c.id),['222']);observer.close();
  await page.setContent('<div class="is-paywall-clipped"><div id="content_views">这段正文长度虽然足够，但它只是尚未解锁的预览，不应被视为完整文章数据。</div><div class="simple-vip-paywall">解锁文章</div></div>');
  await assert.rejects(extractDetail(page,'csdn',{id:'111'},manager,{alreadyOpened:true}),e=>e.code==='access_denied');
  await page.route('https://passport.csdn.net/**',r=>r.fulfill({status:200,body:'测试登录页'}));await page.setContent('<div class="passport-login-container"><iframe src="https://passport.csdn.net/account/login"></iframe></div>');await assert.rejects(manager.gate(page),e=>e.code==='login_required');
 }finally{await browser.close();}
});
test('Douyin visible div cards resolve source only after ordinary click',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),manager=new BrowserManager();
 await page.route('https://www.douyin.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<div class="search-result-card"><div id="card"><div class="videoImage"></div><div class="hu36PKCP">测试视频</div></div></div><script>document.querySelector("#card").onclick=()=>{history.pushState({},"","?modal_id=123456");const b=document.createElement("button");b.dataset.e2e="close-icon";b.innerText="关闭";b.onclick=e=>{e.stopPropagation();b.remove();history.back();};document.body.append(b);};</script>'}));
 try{await page.goto('https://www.douyin.com/jingxuan/search/fixture');const observer=new Observer(page,'douyin');const cards=await visibleCandidates(page,'douyin',observer);assert.equal(cards.length,1);assert.equal(cards[0].uiCard,true);const opened=await clickCandidate(page,'douyin',cards[0],manager);assert.equal(opened.candidate.id,'123456');await returnToResults(opened,manager);assert.equal(new URL(page.url()).searchParams.has('modal_id'),false);observer.close();}finally{await browser.close();}
});
