import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import {BrowserManager} from '../src/browser.mjs';
import {getPlaywright,config} from '../src/config.mjs';

function fixture(){
 const browser=new EventEmitter();browser.connected=true;browser.isConnected=()=>browser.connected;
 const context=new EventEmitter();context.browser=()=>browser;context.setDefaultNavigationTimeout=()=>{};context.setDefaultTimeout=()=>{};context.pages=()=>[];
 browser.contexts=()=>[context];return{browser,context};
}
test('CDP disconnect clears cached browser/context/pages; failed reconnect uses fresh persistent owner',async()=>{
 const old=fixture(),fresh=fixture();let attempts=0,launches=0;
 const chromium={connectOverCDP:async()=>{if(attempts++)throw new Error('endpoint offline');return old.browser;},launchPersistentContext:async()=>{launches++;return fresh.context;}};
 const manager=new BrowserManager({chromium,settings:{browserCdpEndpoint:'http://127.0.0.1:1',platformWindows:true}});
 assert.equal(await manager.open(),old.context);
 manager.loginPages.set('toutiao',{isClosed:()=>false,context:()=>old.context});
 old.browser.connected=false;old.browser.emit('disconnected');
 assert.equal(manager.browser,null);assert.equal(manager.context,null);assert.equal(manager.loginPages.size,0);
 assert.equal(await manager.open(),fresh.context);assert.equal(manager.browser,fresh.browser);assert.equal(launches,1);
 old.context.emit('close');assert.equal(manager.context,fresh.context);assert.equal(manager.browser,fresh.browser);
});
test('disconnected context is rejected even before close event, concurrent opens coalesce',async()=>{
 const old=fixture(),fresh=fixture();old.browser.connected=false;let launches=0;
 const manager=new BrowserManager({chromium:{launchPersistentContext:async()=>{launches++;await new Promise(r=>setTimeout(r,10));return fresh.context;}},settings:{}});
 manager.context=old.context;manager.browser=old.browser;
 assert.deepEqual(await Promise.all([manager.open(),manager.open()]),[fresh.context,fresh.context]);assert.equal(launches,1);
});
test('real browser recreates platform window after close without using stale CDP owner',async()=>{
 const dir=await fs.mkdtemp('E:/Codex/temp/20261107-knowflow-global-ranking-lifecycle-');
 const settings={...config,profileDir:dir,headless:true,browserCdpEndpoint:'http://127.0.0.1:1',platformWindows:true};
 const manager=new BrowserManager({chromium:getPlaywright().chromium,settings});let first,second;
 try{
  first=await manager.open();await first.close();
  second=await manager.open();assert.notEqual(first,second);
  // Reproduce the historical stale-property condition independently of the cleanup fix.
  manager.browser={newBrowserCDPSession:async()=>{throw new Error('STALE_BROWSER_USED');}};
  const page=await manager.newPlatformPage('toutiao');assert.equal(page.context(),second);assert.equal(page.isClosed(),false);
  await page.setContent('<article><h1>恢复后的详情</h1><p>本地公开页面读取正常</p></article>');
  assert.equal(await page.locator('h1').innerText(),'恢复后的详情');
  await page.close();
 }finally{await second?.close().catch(()=>{});await first?.close().catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
});
