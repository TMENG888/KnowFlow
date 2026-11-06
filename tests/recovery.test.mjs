import test from 'node:test';
import assert from 'node:assert/strict';
import {readiness,RecoveryMonitor} from '../src/recovery.mjs';
import {BrowserManager} from '../src/browser.mjs';
import {Store} from '../src/store.mjs';
import {getPlaywright} from '../src/config.mjs';
const baseline={auth:true,authFingerprint:'old',results:0,url:'https://www.zhihu.com/search?q=x',issue:'access_denied'};
test('existing logged in cookie with a blank page never authorizes repeat retry',()=>{assert.equal(readiness({...baseline,issue:null},baseline,{}).ready,false);assert.equal(readiness({...baseline,issue:'access_denied',authFingerprint:'new'},baseline,{}).ready,false);});
test('new session resumes once and active timed protection always wins',()=>{const now=Date.now(),current={...baseline,issue:null,authFingerprint:'new'};assert.equal(readiness(current,baseline,{}).ready,true);assert.equal(readiness(current,baseline,{until:new Date(now+60000).toISOString(),now}).ready,false);assert.equal(readiness(current,baseline,{until:new Date(now-1000).toISOString(),now}).ready,true);});
test('unchanged detail/paywall cannot produce infinite auto resume',()=>{const current={auth:true,authFingerprint:'same',results:1,url:'https://blog.csdn.net/a/article/details/1',issue:null};assert.equal(readiness(current,current,{}).ready,false);});
test('unrelated readable Zhihu article cannot be mistaken for recovery of the blocked source',()=>{const current={auth:false,results:1,url:'https://zhuanlan.zhihu.com/p/222',issue:null};assert.equal(readiness(current,{...current,results:0,issue:'access_denied'},{expectedSource:'article-111'}).ready,false);});
test('Playwright page navigation and DOM change really trigger one recovery, stop cancels it',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();
 await context.route('https://www.xiaohongshu.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><body>登录后查看搜索结果 <a id="login" href="/search_result?keyword=fixture&success=1">人工登录完成</a></body></html>'}));
 const page=await context.newPage();await page.goto('https://www.xiaohongshu.com/search_result?keyword=fixture');const store=new Store(':memory:');store.saveTask({id:'fixture',createdAt:new Date().toISOString(),status:'partial',stages:[]});store.item('fixture',{platform:'csdn',sourceId:'saved',body:'already persisted'});
 const manager=new BrowserManager();let resumed=0;const monitor=new RecoveryMonitor(manager,store,async()=>{resumed++;});
 await monitor.watch('fixture','xiaohongshu',page,'login_required');
 await context.unroute('https://www.xiaohongshu.com/**');await context.route('https://www.xiaohongshu.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body><a href="/explore/666666666666666666666666">真实浏览器DOM测试结果</a></body></html>'}));
 try{await page.locator('#login').click();await new Promise(r=>setTimeout(r,1600));await monitor.tick();await monitor.tick();assert.equal(resumed,1);assert.equal(store.items('fixture').length,1);
 monitor.stop('fixture');assert.equal(monitor.status('fixture').length,0);await monitor.tick();assert.equal(resumed,1);}finally{monitor.close();store.close();await browser.close();}
});
