import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {DoubaoBrowser,imageDimensions} from '../src/doubao-browser.mjs';
import {getPlaywright} from '../src/config.mjs';

test('a failed placeholder followed by a recovered image in the same confirmed reply downloads that image without resubmission',async()=>{
 const dir=path.join('E:/Codex/temp/knowflow-first-two-chapters','recovered-result-test',randomUUID());await fs.mkdir(dir,{recursive:true});
 const bytes=await fs.readFile(new URL('../assets/illustrations/author-graphrag-reference.png',import.meta.url));
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),p=await browser.newPage();
 try{
  await p.route('https://www.doubao.com/**',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await p.goto('https://www.doubao.com/chat/recovered');
  await p.setContent('<div class="v_list_row" style="--cls:confirmed-reply"><div data-testid="receive_message"><div data-testid="message_image_content" data-finished="true">生成失败</div><div data-testid="message_image_content" data-finished="true"><div data-testid="mdbox_image" style="width:100px;height:60px">已生成</div><button data-testid="edit_image_hover_tag_download_btn">下载真图</button></div></div></div>');
  assert.equal(await p.getByTestId('message_image_content').count(),2);
  const adapter=new DoubaoBrowser({settings:{tempDir:dir},pollMs:1});adapter.waitReady=async()=>{};
  let downloads=0;adapter.downloadOriginal=async(page,button)=>{assert.equal(page,p);assert.equal(await button.innerText(),'下载真图');downloads++;return bytes;};
  const item={id:randomUUID(),compiledPrompt:'原提交',checkpoint:{phase:'submitted',beforeUrl:'https://www.doubao.com/chat',url:p.url(),responseKey:'confirmed-reply',beforeResponseKeys:[]}};
  const result=await adapter.collect(p,item,{dir,progress:()=>{},checkpoint:()=>{}});
  assert.equal(downloads,1);assert.equal(item.checkpoint.phase,'downloaded');assert.equal(result.conversationUrl,p.url());assert.deepEqual(await fs.readFile(path.join(dir,result.filename)),bytes);assert.equal(result.width,imageDimensions(bytes).width);
 }finally{await browser.close();}
});
