import test from 'node:test';import assert from 'node:assert/strict';import {getPlaywright} from '../src/config.mjs';import {BrowserManager} from '../src/browser.mjs';
test('小红书公开笔记的可关闭登录弹窗正常关闭；真实验证和登录限制仍阻断',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.route('https://www.xiaohongshu.com/**',r=>r.fulfill({contentType:'text/html',body:'<div id="noteContainer">公开笔记的完整正文</div><div class="login-container">登录后查看更多<div class="close-button" onclick="this.parentNode.remove()">关闭</div></div>'}));await p.goto('https://www.xiaohongshu.com/explore/123');const manager=new BrowserManager();await manager.gate(p);assert.equal(await p.locator('.login-container').count(),0);
 await p.setContent('<div>请先登录</div><div class="login-container"><div class="close-button">关闭</div></div>');await assert.rejects(manager.gate(p),e=>e.code==='login_required');
 await p.setContent('<div id="noteContainer">公开笔记</div><div>请完成以下验证</div><div class="login-container"><div class="close-button">关闭</div></div>');await assert.rejects(manager.gate(p),e=>e.code==='verification_required');assert.equal(await p.locator('.login-container').count(),1);
 }finally{await b.close();}
});
