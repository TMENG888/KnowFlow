import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {getPlaywright,config} from '../src/config.mjs';
import {BrowserManager,Observer} from '../src/browser.mjs';
import {advanceToutiaoResults,toutiaoResultSnapshot} from '../src/toutiao-pagination.mjs';
import {visibleCandidates} from '../src/ui-navigation.mjs';
import {Store} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';

const card=id=>`<div class="cs-header"><a target="_blank" href="https://www.toutiao.com/article/${id}/">测试文章${id}</a></div>`;
const link=(n,label='下一页')=>`<a href="https://so.toutiao.com/search?keyword=fixture&page=${n}">${label}</a>`;
const launch=()=>getPlaywright().chromium.launch({channel:'msedge',headless:true});
const opts={keyword:'fixture',pause:async()=>{},timeoutMs:2500};
test('ordinary next click waits for DOM replacement, not just URL change; excludes external candidates',async()=>{
 const browser=await launch(),page=await browser.newPage(),manager=new BrowserManager(),observer=new Observer(page,'toutiao');
 try{
  await page.route('https://so.toutiao.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="results">${card(1)}</div>${link(2)}<script>document.querySelector('a[href*="page=2"]').onclick=e=>{e.preventDefault();history.pushState({},'',e.currentTarget.href);setTimeout(()=>document.querySelector('#results').innerHTML=${JSON.stringify(card(2)+'<div class="cs-header"><a href="https://blog.csdn.net/a/article/details/999">外站</a></div>')},150);};</script>`}));
  await page.goto('https://so.toutiao.com/search?keyword=fixture&page=1');const actions=[];
  const result=await advanceToutiaoResults(page,manager,{...opts,log:(m,e)=>actions.push(e)});
  assert.equal(result.advanced,true);assert.deepEqual((await visibleCandidates(page,'toutiao',observer)).map(c=>c.id),['2']);
  assert.ok(actions.some(a=>a.action==='click_next_page'));assert.ok(actions.some(a=>a.action==='next_page_ready'));
 }finally{observer.close();await browser.close();}
});
test('unchanged next result is an explicit failure; disabled next, cancellation and protection stay preserved',async()=>{
 const browser=await launch(),page=await browser.newPage(),manager=new BrowserManager();
 try{
  await page.route('https://so.toutiao.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:card(1)+'<button onclick="void 0">下一页</button>'}));await page.goto('https://so.toutiao.com/search?keyword=fixture');
  await assert.rejects(advanceToutiaoResults(page,manager,{...opts,timeoutMs:600}),/SEARCH_PAGINATION_STALLED/);
  await page.setContent(card(1)+'<button disabled>下一页</button>');assert.equal((await advanceToutiaoResults(page,manager,opts)).reason,'next_disabled');
  const controller=new AbortController();controller.abort();await assert.rejects(advanceToutiaoResults(page,manager,{...opts,signal:controller.signal}),/STOP_REQUESTED/);
  await assert.rejects(advanceToutiaoResults(page,{gate:async()=>{throw Object.assign(new Error('需要人工验证'),{code:'verification_required'});}},opts),e=>e.code==='verification_required');
 }finally{await browser.close();}
});
test('repeated pages are stopped and external next links are never followed',async()=>{
 const browser=await launch(),page=await browser.newPage(),manager=new BrowserManager();
 try{
  await page.route('https://so.toutiao.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:card(new URL(r.request().url()).searchParams.get('page')||1)+link(2)}));await page.goto('https://so.toutiao.com/search?keyword=fixture&page=1');
  const visited=new Set([(await toutiaoResultSnapshot(page)).fingerprint]);await advanceToutiaoResults(page,manager,{...opts,visited});
  await page.setContent(card(2)+link(1));await assert.rejects(advanceToutiaoResults(page,manager,{...opts,visited}),/SEARCH_PAGINATION_LOOP/);
  await page.setContent(card(1)+'<a href="https://example.invalid/search?keyword=fixture">下一页</a>');assert.equal((await advanceToutiaoResults(page,manager,opts)).reason,'next_not_found');
 }finally{await browser.close();}
});
test('engine resumes 7/10 across real paginated UI, skips external-only page, deduplicates and reaches 10/10',async()=>{
 const browser=await launch(),context=await browser.newContext(),old={pacing:config.pacing,readScrollSteps:config.readScrollSteps,maxSearchScrolls:config.maxSearchScrolls,maxSearchPages:config.maxSearchPages,outputDir:config.outputDir};
 const dir='E:/Codex/temp/20261107-knowflow-toutiao-pagination/'+randomUUID();await fs.mkdir(dir,{recursive:true});
 Object.assign(config,{pacing:{action:[0,0],read:[0,0],scroll:[0,0],key:[0,0]},readScrollSteps:0,maxSearchScrolls:1,maxSearchPages:5,outputDir:dir});
 const pages=[],requests=[];
 context.on('page',p=>{pages.push(p);const wait=p.waitForTimeout.bind(p);p.waitForTimeout=ms=>wait(Math.min(ms,10));});
 await context.route('**/*',async r=>{
  const u=new URL(r.request().url());requests.push(u.href);
  const detail=u.hostname==='www.toutiao.com'&&u.pathname.startsWith('/article/');
  const n=Number(u.searchParams.get('page')||1);
  const results=n===1?card(111)+card(112):n===2?'<div class="cs-header"><a href="https://blog.csdn.net/a/article/details/999">外站文章</a></div>':card(118)+card(118)+card(119)+card(120);
  const html=detail?`<h1>测试详情${u.pathname}</h1><article class="article-content">这是本地测试的完整正文内容，仅用于测试头条跨页续采，不会计入真实平台采集记录。文章内容需要足够长以通过正文检查。</article>`:`<form><input type="search" value="fixture"><button>搜索</button></form><div id="results">${results}</div>${n<3?link(n+1):'<button disabled>下一页</button>'}<script>document.querySelector('form').onsubmit=e=>{e.preventDefault();history.pushState({},'', '/search?keyword=fixture&page=1');};</script>`;
  await r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});
 });
 const store=new Store(':memory:'),engine=new Engine(store);
 const task={id:'fixture-toutiao-pages',keyword:'fixture',platforms:['toutiao'],target:10,transcribeVideos:false,autoResumeAfterLogin:false,createdAt:new Date().toISOString(),stages:[{platform:'toutiao',status:'queued',accepted:7,target:10,failedDetails:0}]};
 for(let id=111;id<=117;id++)store.item(task.id,{platform:'toutiao',sourceId:String(id),title:'既有文章',body:'既有完整正文',contentStatus:'completed',kind:'article',metrics:{},collectedAt:new Date().toISOString()});
 engine.browser.open=async()=>context;engine.browser.workPage=async()=>{const p=await context.newPage();await p.goto('https://so.toutiao.com/search?keyword=fixture&page=1');return p;};
 try{
  store.saveTask(task);await engine.run(task);
  assert.equal(task.status,'completed');assert.equal(task.stages[0].accepted,10);assert.equal(task.stages[0].searchPage,3);
  assert.equal(store.items(task.id).length,10);assert.equal(store.items(task.id).filter(i=>i.navigationEvidence?.searchPage===3).length,3);
  assert.equal(store.events(task.id).filter(e=>e.action==='click_next_page').length,2);
  assert.equal(requests.filter(u=>u.includes('csdn.net')).length,0);assert.equal(requests.filter(u=>u.includes('/article/118/')).length,1);
 }finally{engine.recovery.close();store.close();Object.assign(config,old);await browser.close();}
});
