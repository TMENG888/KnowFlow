import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Semaphore} from '../src/scheduler.mjs';
import {getPlaywright} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';
test('bounded concurrency overlaps work and releases all permits',async()=>{
 const pool=new Semaphore(2);let active=0,max=0;
 await Promise.all(Array.from({length:5},()=>pool.run(async()=>{max=Math.max(max,++active);await new Promise(r=>setTimeout(r,15));active--;})));
 assert.equal(max,2);assert.equal(pool.active,0);assert.equal(pool.queue.length,0);
});
test('queued media cancellation never starts work and leaves following jobs usable',async()=>{
 const pool=new Semaphore(1),release=await pool.acquire(),controller=new AbortController();let ran=false;
 const queued=pool.run(()=>{ran=true;},controller.signal);controller.abort();await assert.rejects(queued,/STOP_REQUESTED/);release();await pool.run(()=>{});assert.equal(ran,false);assert.equal(pool.active,0);
});
test('two platform engines really search and collect concurrently without crossing popup ownership',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext();
 const text='这是本地拦截的充分长测试正文，专用于验证并发平台和弹出页归属，不作为任何平台真实采集数据。';
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url()),csdn=u.hostname.includes('csdn'),detail=/\/article\//.test(u.pathname);
  const html=detail?`<h1>并发测试</h1>${csdn?'<div id="content_views">'+text+'</div>':'<article>'+text+'</article>'}`:`<form><input ${csdn?'id="toolbar-search-input"':'type="search"'}><button>搜索</button></form><div id="results"></div><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();history.pushState({},'', '/search?${csdn?'q':'keyword'}='+encodeURIComponent(document.querySelector('input').value));document.querySelector('#results').innerHTML='<div class="cs-header"><a target="_blank" href="${csdn?'https://blog.csdn.net/fixture/article/details/222':'https://www.toutiao.com/article/111/'}">并发测试</a></div>';};</script>`;
  await route.fulfill({status:200,contentType:'text/html',body:html});
 });
 const store=new Store(':memory:'),engine=new Engine(store);engine.browser.context=context;engine.browser.open=async()=>context;engine.browser.workPage=async()=>context.newPage();
 const task={id:'fixture-concurrent-'+randomUUID(),keyword:'fixture',platforms:['toutiao','csdn'],target:1,transcribeVideos:false,autoResumeAfterLogin:false,createdAt:new Date().toISOString(),stages:['toutiao','csdn'].map(platform=>({platform,status:'queued',target:1,accepted:0,discovered:0,pendingContent:0,failedDetails:0}))};
 try{store.saveTask(task);await engine.run(task);assert.equal(task.status,'completed');assert.equal(store.items(task.id).length,2);const starts=store.events(task.id).filter(e=>e.message==='开始检索：fixture');assert.equal(starts.length,2);assert.ok(Math.abs(Date.parse(starts[0].at)-Date.parse(starts[1].at))<500);for(const item of store.items(task.id)){assert.equal(item.navigationEvidence.method,'visible_result_click');assert.ok(new URL(item.url).hostname.includes(item.platform==='csdn'?'csdn':'toutiao'));}}finally{engine.recovery.close();store.close();await browser.close();}
});
