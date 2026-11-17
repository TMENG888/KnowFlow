import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {DoubaoBrowser} from '../src/doubao-browser.mjs';import {config,getPlaywright} from '../src/config.mjs';
test('requested image model is selected and recorded, and unavailable models stop before submission',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),p=await b.newPage();
 try{
  await p.setContent(`<div data-testid="chat_input"><button onclick="document.querySelector('[role=menuitem]').hidden=false">模型 Seedream 5.0 Flash</button></div><div role="menuitem" hidden onclick="document.querySelector('button').innerText='模型 Seedream 5.5';this.hidden=true"><span>Seedream 5.5</span></div>`);
  const adapter=new DoubaoBrowser({settings:{illustrationModel:'Seedream 5.5'}}),item={};let saves=0;
  assert.equal(await adapter.selectModel(p,item,{checkpoint:()=>saves++}),'Seedream 5.5');assert.equal(item.generationModel,'Seedream 5.5');assert.match(item.selectedModelControl,/5\.5$/);assert.equal(saves,1);
  await p.setContent('<div data-testid="chat_input"><button>模型 Seedream 5.0 Flash</button></div>');
  await assert.rejects(adapter.selectModel(p,{}),e=>e.code==='DOUBAO_MODEL_UNAVAILABLE');
 }finally{await b.close();}
});
test('corrected attempts start fresh with only the corrected prompt, while submitted checkpoints do not resend',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),p=await b.newPage(),dir=path.join(config.tempDir,'doubao-submit-tests',randomUUID());await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'style.png');await fs.writeFile(file,'fixture');
 try{
  await p.route('https://www.doubao.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<div data-testid="flow_chat_sidebar"><button data-testid="create_conversation_button" onclick="window.created=(window.created||0)+1;history.replaceState({},'', '/chat')">新对话</button></div><div data-testid="chat_input"><button>比例</button><button>模型 Seedream 5.5</button></div><div role="menu"><span>16:9</span></div><button data-testid="skill_input_exit_button">图像生成</button><input type="file" data-testid="upload-file-input"><div data-testid="chat_input_input"><div contenteditable="true"></div></div><button data-testid="chat_input_send_button" aria-disabled="false" onclick="window.sent=document.querySelector('[contenteditable]').innerText;window.sends=(window.sends||0)+1;document.querySelector('[contenteditable]').innerText=''">发送</button>`}));await p.goto('https://www.doubao.com/chat/123');
  const adapter=new DoubaoBrowser(),item={compiledPrompt:'修正后的完整绘图指令',attempts:[{conversationUrl:p.url(),review:{reason:'上次错误的箭头描述，不应当原样喂给生图'}}]};adapter.page=async()=>p;adapter.waitReady=async()=>{};adapter.uploadReference=async()=>{};let collected=0;adapter.collect=async()=>{collected++;return {ok:true};};
  const ctx={styleFile:file,dir,progress:()=>{},checkpoint:()=>{}};await adapter.generateOne(item,ctx);assert.deepEqual(await p.evaluate(()=>({created:window.created,sends:window.sends,sent:window.sent})),{created:1,sends:1,sent:item.compiledPrompt});assert.equal(item.checkpoint.phase,'submitted');
  adapter.requestObserved=async()=>true;await adapter.generateOne(item,ctx);assert.equal(await p.evaluate(()=>window.sends),1);assert.equal(collected,2);
 }finally{await b.close();}
});
test('reference upload must finish; a stalled upload retries only the attachment before image submission',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),p=await b.newPage(),dir=path.join(config.tempDir,'doubao-upload-tests',randomUUID());await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'style.png');await fs.writeFile(file,'fixture');
 try{
  await p.setContent(`<input type="file" data-testid="upload-file-input"><div data-testid="attachment_area"></div><button data-testid="attachment-delete-btn" onclick="document.querySelector('[data-testid=attachment_area]').innerHTML=''">删除附件</button><script>document.querySelector('input').onchange=()=>{if(!document.querySelector('input').files.length)return;window.uploads=(window.uploads||0)+1;document.querySelector('[data-testid=attachment_area]').innerHTML='<div data-testid="attachment-image-card"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%3E%3C%2Fsvg%3E">'+(window.uploads===1?'<div role="progressbar" aria-valuenow="0"></div>':'')+'</div>';};</script>`);
  const statuses=[],adapter=new DoubaoBrowser();await adapter.uploadReference(p,file,{timeoutMs:200,progress:s=>statuses.push(s)});assert.equal(await p.evaluate(()=>window.uploads),2);assert.equal(await p.locator('[role=progressbar]').count(),0);assert.equal(statuses.length,2);assert.ok(statuses.every(s=>s==='uploading_reference'));
 }finally{await b.close();}
});
test('exhausted image quota is reported separately from an uncertain image submission',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),p=await b.newPage();try{await p.setContent('<p>今日图片生成免费额度已用完。开通订阅畅享更多额度。</p>');await assert.rejects(new DoubaoBrowser().checkQuota(p),e=>e.code==='DOUBAO_QUOTA_EXHAUSTED');await p.setContent('<p>图片生成中</p>');await new DoubaoBrowser().checkQuota(p);}finally{await b.close();}
});
