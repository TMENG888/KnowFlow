import test from 'node:test';
import assert from 'node:assert/strict';
import {DoubaoBrowser,conversationUrl} from '../src/doubao-browser.mjs';
import {getPlaywright} from '../src/config.mjs';

test('hidden prompts bind only a unique confirmed reply and retain its identity across virtualized rows',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),p=await browser.newPage(),adapter=new DoubaoBrowser();
 const reply=(key,text)=>`<div class="v_list_row" style="--cls:${key}"><div data-testid="receive_message">${text}</div></div>`;
 try{
  await p.route('https://www.doubao.com/**',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await p.goto('https://www.doubao.com/chat/123');
  const item={compiledPrompt:'原生图指令',checkpoint:{phase:'submitted',beforeUrl:'https://www.doubao.com/chat',url:p.url(),submittedPrompt:'原生图指令'}};
  await p.setContent(reply('r-first','第一张完成图'));assert.equal(await adapter.hasPrompt(p,item.compiledPrompt),false);assert.equal(await adapter.requestObserved(p,item),true);assert.equal(await(await adapter.resultFor(p,item)).innerText(),'第一张完成图');assert.equal(item.checkpoint.responseKey,'r-first');
  await p.setContent(reply('r-later','其他新图')+reply('r-first','第一张完成图'));assert.equal(await(await adapter.resultFor(p,item)).innerText(),'第一张完成图');
  await p.setContent(reply('r-later','其他新图'));assert.equal(await adapter.resultFor(p,item),null);
  assert.equal(conversationUrl('https://www.doubao.com/chat/local_123'),null);
  const provisional={compiledPrompt:'新请求',checkpoint:{phase:'submitted',beforeUrl:'https://www.doubao.com/chat',beforeResponseKeys:[],url:'https://www.doubao.com/chat/local_123'}};
  await p.setContent(reply('r-settled','新会话生成图'));assert.equal(await(await adapter.resultFor(p,provisional)).innerText(),'新会话生成图');assert.equal(provisional.checkpoint.url,p.url());
  const ambiguous={compiledPrompt:'新请求',checkpoint:{phase:'submitted',beforeUrl:'https://www.doubao.com/chat',url:p.url()}};await p.setContent(reply('r-a','甲')+reply('r-b','乙'));assert.equal(await adapter.resultFor(p,ambiguous),null);
  const repair={compiledPrompt:'修图',checkpoint:{phase:'submitted',beforeUrl:p.url(),url:p.url(),beforeResponseKeys:['r-a']}};assert.equal(await(await adapter.resultFor(p,repair)).innerText(),'乙');assert.equal(repair.checkpoint.responseKey,'r-b');
  await p.goto('https://www.doubao.com/chat/999');await p.setContent(reply('r-first','其他会话图'));assert.equal(await adapter.resultFor(p,item),null);
  await p.goto('https://www.doubao.com/chat/123');await p.setContent(reply('r-a','旧图'));assert.equal(await adapter.resultFor(p,{compiledPrompt:'不确定提交',checkpoint:{phase:'submitting',beforeUrl:'https://www.doubao.com/chat',url:p.url()}}),null);
  await p.setContent('<div class="v_list_row"><div data-testid="send_message">准确的原始指令</div></div>'+reply('r-target','匹配的结果')+reply('r-other','别的结果'));assert.equal(await(await adapter.resultFor(p,{compiledPrompt:'准确的原始指令',checkpoint:{phase:'submitted',url:p.url()}})).innerText(),'匹配的结果');
 }finally{await browser.close();}
});
