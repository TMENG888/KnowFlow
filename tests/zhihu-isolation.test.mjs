import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getPlaywright} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';
import {config} from '../src/config.mjs';
test('Zhihu durable queue never overwrites completion when list encounters same URL again',()=>{
 const store=new Store(':memory:');const job={platform:'zhihu',sourceId:'article-111',observedHref:'https://zhuanlan.zhihu.com/p/111',status:'pending'};store.queueDetail('fixture',job);job.status='completed';store.saveDetailJob('fixture',job);store.queueDetail('fixture',{...job,status:'pending'});assert.equal(store.detailJobs('fixture').length,1);assert.equal(store.detailJobs('fixture')[0].status,'completed');store.close();
});
test('recovered detail is consumed in place without discarding it through a new navigation',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),listContext=await browser.newContext(),detailContext=await browser.newContext();
 const list=await listContext.newPage(),detail=await detailContext.newPage(),store=new Store(':memory:'),engine=new Engine(store),old=config.pacing;
 config.pacing={action:[1,1],read:[1,1],scroll:[1,1],key:[1,1]};
 await listContext.route('**/*',r=>r.fulfill({status:200,contentType:'text/html',body:'<input class="SearchBar-input"><button onclick="history.pushState({},\'\',\'/search?q=fixture\')">搜索</button>'}));
 let requests=0;await detailContext.route('**/*',r=>{requests++;return r.fulfill({status:200,contentType:'text/html',body:'<h1 class="Post-Title">已经人工恢复的文章</h1><div class="Post-RichTextContainer"><div class="RichText">这是已经在详情窗口正常加载的充分长公开正文，采集器应当读取它，不能重新打开链接丢失恢复页面。</div></div>'});});
 const url='https://zhuanlan.zhihu.com/p/222';await detail.goto(url);
 engine.browser.open=async()=>listContext;engine.browser.zhihuPages=async()=>({list,detail,listContext,detailContext});const navigate=engine.browser.navigate.bind(engine.browser);engine.browser.navigate=async(p,u)=>{assert.notEqual(p,detail,'recovered detail must not navigate again');return navigate(p,u);};
 const task={id:'fixture-recovered-'+randomUUID(),keyword:'fixture',platforms:['zhihu'],target:1,transcribeVideos:false,autoResumeAfterLogin:false,createdAt:new Date().toISOString(),stages:[{platform:'zhihu',status:'queued',target:1,accepted:0,pendingContent:0,discovered:0,failedDetails:0}]};
 try{store.saveTask(task);store.queueDetail(task.id,{platform:'zhihu',sourceId:'article-222',url,observedHref:url,title:'已恢复',resultScope:'primary_search_result',status:'blocked',listUrl:'https://www.zhihu.com/search?q=fixture',observedAt:new Date().toISOString()});await engine.run(task);assert.equal(task.status,'completed',JSON.stringify(task.stages));assert.equal(requests,1);assert.equal(store.items(task.id)[0].sourceId,'article-222');}finally{config.pacing=old;engine.recovery.close();store.close();await browser.close();}
});
test('real browser contexts isolate authenticated list from anonymous detail and consume observed links',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});const listContext=await browser.newContext(),detailContext=await browser.newContext();
 await listContext.addCookies([{name:'z_c0',value:'fixture-auth-only-list',domain:'.zhihu.com',path:'/'}]);const received=[];
 await listContext.route('**/*',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><input class="SearchBar-input"><button id="search">搜索</button><div id="results"></div><script>localStorage.setItem("auth-fixture","list-only");document.querySelector("#search").onclick=()=>{history.pushState({},"","/search?q="+encodeURIComponent(document.querySelector("input").value));const a=document.createElement("a");a.href="https://zhuanlan.zhihu.com/p/111";a.textContent="测试来源文章";const card=document.createElement("div");card.className="SearchResult-Card";const title=document.createElement("h2");title.className="ContentItem-title";title.append(a);card.append(title);document.querySelector("#results").replaceChildren(card);};</script>'}));
 await detailContext.route('**/*',r=>{received.push({url:r.request().url(),cookie:r.request().headers().cookie||''});return r.fulfill({status:200,contentType:'text/html',body:'<h1 class="Post-Title">测试来源文章</h1><div class="Post-RichTextContainer"><div class="RichText">这是仅用于上下文隔离集成测试的充分长正文，不会进入真实采集结果。详情浏览器无需登录读取公开内容。</div></div>'});});
 const list=await listContext.newPage(),detail=await detailContext.newPage(),store=new Store(':memory:'),engine=new Engine(store),errors=[];list.on('pageerror',e=>errors.push(e.message));
 engine.browser.open=async()=>listContext;engine.browser.zhihuPages=async()=>({list,detail,listContext,detailContext});
 const task={id:'fixture-zhihu-'+randomUUID(),keyword:'fixture',platforms:['zhihu'],target:1,transcribeVideos:false,autoResumeAfterLogin:false,createdAt:new Date().toISOString(),stages:[{platform:'zhihu',status:'queued',target:1,accepted:0,pendingContent:0,discovered:0,failedDetails:0}]};
 try{
  store.saveTask(task);await engine.run(task);assert.equal(task.status,'completed',JSON.stringify({errors,html:await list.content(),stages:task.stages,events:store.events(task.id)}));const items=store.items(task.id);assert.equal(items.length,1);assert.equal(items[0].sourceId,'article-111');assert.equal(items[0].navigationEvidence.method,'observed_result_link_handoff');assert.equal(items[0].navigationEvidence.cookiesTransferred,false);assert.equal(store.detailJobs(task.id)[0].status,'completed');
  assert.equal((await listContext.cookies()).some(c=>c.name==='z_c0'),true);assert.equal((await detailContext.cookies()).some(c=>c.name==='z_c0'),false);assert.equal(await detail.evaluate(()=>localStorage.getItem('auth-fixture')),null);assert.ok(received.length>0);assert.ok(received.every(r=>!r.cookie.includes('fixture-auth-only-list')));
 }finally{engine.recovery.close();store.close();await browser.close();}
});
