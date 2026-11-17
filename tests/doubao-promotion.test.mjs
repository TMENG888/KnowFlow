import test from 'node:test';import assert from 'node:assert/strict';import {getPlaywright} from '../src/config.mjs';import {DoubaoBrowser} from '../src/doubao-browser.mjs';
test('native desktop promotion dismissal unblocks a normal action without dismissing captcha',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),p=await b.newPage(),adapter=new DoubaoBrowser();
 try{
  await p.setContent('<button id="target" onclick="this.textContent=\'clicked\'">比例</button><div id="promo" style="position:fixed;inset:0;background:white"><button data-testid="desktop_download_guide_popup_btn">下载电脑版</button><button onclick="document.querySelector(\'#promo\').remove()">下次提醒我</button></div><div id="captcha_container">等待人工验证</div>');
  await adapter.installPageHandlers(p);await p.locator('#target').click({timeout:5000});assert.equal(await p.locator('#target').innerText(),'clicked');assert.equal(await p.locator('#promo').count(),0);assert.equal(await p.locator('#captcha_container').innerText(),'等待人工验证');
 }finally{await b.close();}
});
