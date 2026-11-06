import test from 'node:test';
import assert from 'node:assert/strict';
import {getPlaywright} from '../src/config.mjs';
import {BrowserManager,zhihuDetailProfile} from '../src/browser.mjs';
test('Zhihu detail profile must remain separate from list and main browser',()=>{assert.equal(zhihuDetailProfile({zhihuDetailProfileDir:'E:/fixture/detail',zhihuListProfileDir:'E:/fixture/list'}),'E:/fixture/detail');assert.throws(()=>zhihuDetailProfile({zhihuDetailProfileDir:'E:/fixture/list',zhihuListProfileDir:'E:/fixture/list'}));assert.throws(()=>zhihuDetailProfile({}));});
test('public article optional login uses normal close button; missing body or access protection stays blocked',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage(),manager=new BrowserManager();let mode='public';
 await page.route('https://zhuanlan.zhihu.com/**',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8">${mode==='protected'?'<div>您当前请求存在异常，暂时限制本次访问 40362</div>':''}${mode!=='missing'?'<div class="Post-RichTextContainer"><div class="RichText">这是一段公开文章的充分长正文，普通用户可以通过正常关闭弹窗后阅读文章内容。</div></div>':''}<div class="Modal-wrapper"><div class="SignFlowModal">验证码登录</div><button class="Modal-closeButton" onclick="this.parentElement.remove()">关闭</button></div>`}));
 try{await page.goto('https://zhuanlan.zhihu.com/p/111');await manager.gate(page);assert.equal(await page.locator('.SignFlowModal').count(),0);mode='missing';await page.reload();await assert.rejects(manager.gate(page),e=>e.code==='login_required');assert.equal(await page.locator('.SignFlowModal').count(),1);mode='protected';await page.reload();await assert.rejects(manager.gate(page),e=>e.code==='access_denied');assert.equal(await page.locator('.SignFlowModal').count(),1);}finally{await browser.close();}
});
test('current lowercase signFlowModal closes normally and public-article marketing toast is not an access requirement',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage(),manager=new BrowserManager();let body=true;
 await page.route('https://zhuanlan.zhihu.com/**',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><div>请您登录后查看更多专业优质内容。</div>${body?'<div class="Post-RichTextContainer"><div class="RichText">这是一篇已经加载的充分长公开文章，正常关闭网站登录弹窗后可以继续阅读正文和参考链接。</div></div>':''}<div class="Modal-wrapper"><div class="Modal signFlowModal">验证码登录<button aria-label="关闭" class="Modal-closeButton" onclick="this.closest('.Modal-wrapper').remove()">×</button></div></div>`}));
 try{await page.goto('https://zhuanlan.zhihu.com/p/333');await manager.gate(page);assert.equal(await page.locator('.signFlowModal').count(),0);body=false;await page.reload();await assert.rejects(manager.gate(page),e=>e.code==='login_required');assert.equal(await page.locator('.signFlowModal').count(),1);}finally{await browser.close();}
});
