import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {config,getPlaywright} from './config.mjs';

export function imageFormat(b){if(b.length<100)throw new Error('下载内容不是完整图片');if(b[0]===137&&b.toString('ascii',1,4)==='PNG')return {ext:'png',mime:'image/png'};if(b[0]===255&&b[1]===216&&b[2]===255)return {ext:'jpg',mime:'image/jpeg'};if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return {ext:'webp',mime:'image/webp'};throw new Error('豆包下载结果不是PNG、JPEG或WebP图片');}
export function conversationUrl(url){try{const u=new URL(url);return u.origin==='https://www.doubao.com'&&/^\/chat\/(?!local_)[\w-]+$/.test(u.pathname)?u.href:null;}catch{return null;}}
export function imageDimensions(b){
 const {ext}=imageFormat(b);if(ext==='png'&&b.length>=24)return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
 if(ext==='jpg'){let i=2;while(i+9<b.length){if(b[i]!==255){i++;continue;}const marker=b[i+1];if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {width:b.readUInt16BE(i+7),height:b.readUInt16BE(i+5)};if(marker===0xd9||marker===0xda)break;const size=b.readUInt16BE(i+2);if(size<2)break;i+=size+2;}}
 if(ext==='webp'){const type=b.toString('ascii',12,16);if(type==='VP8X'&&b.length>=30)return {width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3)};if(type==='VP8 '&&b.length>=30)return {width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff};if(type==='VP8L'&&b.length>=25){const n=b.readUInt32LE(21);return {width:(n&0x3fff)+1,height:((n>>>14)&0x3fff)+1};}}
 throw new Error('无法确认下载图片尺寸，尚未插入');
}
const uncertain=()=>Object.assign(new Error('无法确认此前提交结果；请在豆包窗口核对。系统保留断点，未重复生图'),{code:'DOUBAO_SUBMISSION_UNCERTAIN'});
export class DoubaoBrowser{
 constructor({settings=config,connect=null,pollMs=2500}={}){this.settings=settings;this.connect=connect;this.pollMs=pollMs;this.busy=false;}
 async page(){
  if(this.current&&!this.current.isClosed())return this.current;
  if(this.context){this.current=this.context.pages().find(p=>p.url().startsWith('https://www.doubao.com/chat'))||await this.context.newPage();}
  else{const pw=getPlaywright();if(this.connect||this.settings.doubaoCdpEndpoint){this.browser=await (this.connect?this.connect():pw.chromium.connectOverCDP(this.settings.doubaoCdpEndpoint));this.context=this.browser.contexts()[0];this.owned=false;}
   else{const profile=this.settings.doubaoProfileDir||path.join(this.settings.profileDir,'doubao-illustrations');await fs.mkdir(profile,{recursive:true});this.context=await pw.chromium.launchPersistentContext(profile,{channel:this.settings.browserChannel||'msedge',headless:false,acceptDownloads:true,downloadsPath:path.join(this.settings.tempDir,'doubao-downloads'),locale:'zh-CN',viewport:{width:1440,height:1000}});this.owned=true;}
   this.current=this.context.pages().find(p=>p.url().startsWith('https://www.doubao.com/chat'))||this.context.pages()[0]||await this.context.newPage();
  }if(!this.current.url().startsWith('https://www.doubao.com/chat'))await this.current.goto('https://www.doubao.com/chat/',{waitUntil:'domcontentloaded'});await this.installPageHandlers(this.current);return this.current;
 }
 async installPageHandlers(p){if(this.promotionPage===p)return;await p.addLocatorHandler(p.getByTestId('desktop_download_guide_popup_btn'),async()=>{const later=p.getByRole('button',{name:'下次提醒我',exact:true});if(await later.isVisible())await later.click();});this.promotionPage=p;}
 async auth(page=undefined){const p=page||await this.page();if(await p.getByTestId('to_login_button').isVisible().catch(()=>false))return 'logged_out';if(await p.getByTestId('chat_header_avatar_button').isVisible().catch(()=>false)&&await p.getByTestId('sidebar_footer_setting_entry').isVisible().catch(()=>false))return 'authenticated';return 'unknown';}
 async open(){const p=await this.page();await p.bringToFront();return {state:await this.auth(p),url:p.url()};}
 async checkQuota(p){if(await p.getByText(/今日图片生成免费额度已用完|图片生成额度不足|生图额度已用完/).first().isVisible().catch(()=>false))throw Object.assign(new Error('豆包今日图片生成额度已用完；已保留正文、旧图和提交记录，额度恢复后可继续'),{code:'DOUBAO_QUOTA_EXHAUSTED'});}
 async waitReady(p,{signal,progress}){
  let last;while(true){signal?.throwIfAborted();if(p.isClosed())throw new Error('豆包窗口已关闭，请重新打开后继续');const state=await this.auth(p),verify=await p.locator('#captcha_container').isVisible().catch(()=>false)||await p.getByRole('dialog').filter({hasText:/验证码|安全验证|完成验证/}).isVisible().catch(()=>false);if(state==='authenticated'&&!verify)return;
   const message=verify?'等待你在豆包窗口完成验证，完成后自动继续':state==='logged_out'?'等待豆包登录，成功后自动继续':'正在确认豆包登录状态';if(message!==last){progress(verify?'waiting_verification':'waiting_login',message);last=message;}await delay(this.pollMs,undefined,{signal});
  }
 }
 async generate(item,{styleFile,dir,signal,progress=()=>{},checkpoint=()=>{}}={}){
  if(this.busy)throw new Error('豆包正在生成另一张插图，请等待');this.busy=true;
  try{return await this.generateOne(item,{styleFile,dir,signal,progress,checkpoint});}catch(e){if(/locator\.|strict mode violation/.test(e.message)&&!e.code)throw new Error('豆包页面控件发生变化或被遮挡，已保留正文与提交断点；请检查豆包窗口后继续');throw e;}finally{this.busy=false;}
 }
 async referenceMatches(p,file){
  if(await p.getByTestId('send_message').count())return false;
  const bytes=await fs.readFile(file),expected={name:path.basename(file),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  return p.getByTestId('upload-file-input').evaluate(async(input,expected)=>{const f=input.files?.[0];if(!f||f.name!==expected.name||f.size!==expected.size)return false;const hash=await crypto.subtle.digest('SHA-256',await f.arrayBuffer());return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('')===expected.sha256;},expected);
 }
 async uploadReference(p,file,{signal,progress=()=>{},timeoutMs=90000,reuse=false}={}){
  for(let attempt=0;attempt<2;attempt++){
   signal?.throwIfAborted();progress('uploading_reference',attempt?'样图上传未完成，重新上传一次；尚未提交生图':'正在上传全文样图；上传完成后再提交生图');
   if(!reuse||attempt){await p.getByTestId('upload-file-input').setInputFiles([]);await p.getByTestId('upload-file-input').setInputFiles(file);}
   try{
    await p.waitForFunction(()=>{const card=document.querySelector('[data-testid="attachment_area"] [data-testid="attachment-image-card"]');const img=card?.querySelector('img');return !!(card&&img?.complete&&img.naturalWidth>0&&!card.querySelector('[role="progressbar"]'));},{},{timeout:timeoutMs});
    signal?.throwIfAborted();return;
   }catch(e){signal?.throwIfAborted();if(!/timeout/i.test(e.name+' '+e.message))throw e;if(attempt===1)throw new Error('全文样图上传未完成，尚未提交生图；正文和原插图保留，请检查豆包网络后继续');
    await p.getByTestId('attachment-image-card').last().hover();await p.getByTestId('attachment-delete-btn').last().click();
   }
  }
 }
 async selectModel(p,item,{checkpoint=()=>{}}={}){
  const model=item.generationModel||this.settings.illustrationModel||'Seedream 5.5';
  const control=p.getByTestId('chat_input').locator('button').filter({hasText:/模型/});
  await control.waitFor({state:'visible',timeout:15000});
  if(!(await control.innerText()).trim().endsWith(model)){
   await control.click();const option=p.locator('[role=menuitem]').filter({has:p.getByText(model,{exact:true})});
   if(await option.count()!==1)throw Object.assign(new Error('豆包未提供指定生图模型 '+model+'；尚未提交'),{code:'DOUBAO_MODEL_UNAVAILABLE'});
   await option.click();
   try{await control.filter({hasText:model}).waitFor({state:'visible',timeout:5000});}catch{throw Object.assign(new Error('豆包未能切换到 '+model+'，请检查模型权限；尚未提交'),{code:'DOUBAO_MODEL_UNAVAILABLE'});}
  }
  const selected=await control.innerText();if(!selected.trim().endsWith(model))throw new Error('豆包生图模型与指定模型不一致；尚未提交');
  item.generationModel=model;item.selectedModelControl=selected;checkpoint();return model;
 }
 async generateOne(item,ctx){
  const {styleFile,dir,signal,progress,checkpoint}=ctx,p=await this.page();await this.waitReady(p,ctx);
  const cp=item.checkpoint;
  if(cp){if(!await this.requestObserved(p,item)){const target=conversationUrl(cp.url);if(target&&p.url()!==target)await p.goto(target,{waitUntil:'domcontentloaded'});await this.waitReady(p,ctx);if(!await this.requestObserved(p,item))throw uncertain();}}
  else{
   // A rejected picture is a finished attempt. Use a clean conversation for
   // its corrected prompt so old diagrams and failure descriptions are not
   // treated as new drawing instructions. Unfinished requests resume above.
   const reuseUpload=/全文样图上传未完成/.test(item.message||'')&&await this.referenceMatches(p,styleFile);
   if(!reuseUpload)await p.getByTestId('flow_chat_sidebar').getByTestId('create_conversation_button').click();
   await p.getByTestId('chat_input_input').last().waitFor({state:'visible',timeout:30000});if(!await p.getByTestId('skill_input_exit_button').filter({hasText:'图像生成'}).first().isVisible().catch(()=>false))await p.getByRole('button',{name:'图像生成',exact:true}).last().click();
   const aspectRatio=item.aspectRatio||'16:9';if(!['16:9','3:4'].includes(aspectRatio))throw new Error('尚未支持该生图比例，未提交');
   const ratio=p.getByTestId('chat_input').getByRole('button',{name:/比例/});await ratio.click();await p.getByRole('menu').getByText(aspectRatio,{exact:true}).click();
   const generationModel=await this.selectModel(p,item,ctx);
   await this.uploadReference(p,styleFile,{signal,progress,reuse:reuseUpload});
   const selected=await p.getByTestId('chat_input').locator('button').filter({hasText:/模型/}).innerText();if(!selected.trim().endsWith(generationModel))throw new Error('样图上传后模型选择发生变化；尚未提交');
   const editor=p.getByTestId('chat_input_input').locator('[contenteditable=true]'),submittedPrompt=item.compiledPrompt;await editor.fill(submittedPrompt);
   const send=p.getByTestId('chat_input_send_button');await send.waitFor({state:'visible'});await p.waitForFunction(()=>document.querySelector('[data-testid=chat_input_send_button]')?.getAttribute('aria-disabled')==='false',{},{timeout:60000});
   signal?.throwIfAborted();item.checkpoint={phase:'submitting',beforeUrl:p.url(),beforeResponseKeys:await this.responseKeys(p),submittedPrompt,generationModel,at:new Date().toISOString()};checkpoint();progress('submitting','正在提交豆包 '+generationModel+' 生图');
   try{await send.click({timeout:10000});await p.waitForFunction(()=>!!document.querySelector('[data-testid=chat_input_input]')&&!document.querySelector('[data-testid=chat_input_input]')?.innerText.trim(),{},{timeout:30000});item.checkpoint.phase='submitted';item.checkpoint.url=conversationUrl(p.url());checkpoint();}catch{item.checkpoint.url=conversationUrl(p.url());checkpoint();await this.checkQuota(p);throw uncertain();}
  }
  return this.collect(p,item,ctx);
 }
 async hasPrompt(p,prompt){const needle=prompt.replace(/\s/g,'').slice(0,256);return p.getByTestId('send_message').evaluateAll((es,n)=>es.some(e=>e.innerText.replace(/\s/g,'').includes(n)),needle);}
 async responseKeys(p){return p.getByTestId('receive_message').evaluateAll(es=>es.map(e=>e.closest('.v_list_row')?.style.getPropertyValue('--cls').trim()||'').filter(Boolean));}
 async requestObserved(p,item){if(await this.hasPrompt(p,item.compiledPrompt))return true;return !!await this.resultFor(p,item);}
 async resultFor(p,item){
  const cp=item.checkpoint||{},needle=cp.submittedPrompt||item.compiledPrompt,user=p.getByTestId('send_message').filter({hasText:needle}).last(),row=p.locator('.v_list_row').filter({has:user}).last(),adjacent=row.locator('xpath=following-sibling::div[1]').getByTestId('receive_message');
  if(await adjacent.count()===1)return adjacent;
  // Image mode can hide the submitted message. Bind only a unique response in
  // the confirmed conversation; never fall back to the last visible image.
  const current=conversationUrl(p.url()),saved=conversationUrl(cp.url),fresh=cp.beforeUrl==='https://www.doubao.com/chat'&&(!cp.beforeResponseKeys||cp.beforeResponseKeys.length===0);
  if(cp.phase!=='submitted'||!current||(saved?current!==saved:!fresh))return null;
  const replies=p.getByTestId('receive_message'),keys=await replies.evaluateAll(es=>es.map(e=>e.closest('.v_list_row')?.style.getPropertyValue('--cls').trim()||''));
  if(cp.responseKey){const n=keys.indexOf(cp.responseKey);return n>=0&&keys.lastIndexOf(cp.responseKey)===n?replies.nth(n):null;}
  let indexes=[];
  if(cp.beforeUrl==='https://www.doubao.com/chat'&&keys.length===1)indexes=[0];
  else if(Array.isArray(cp.beforeResponseKeys)&&cp.beforeResponseKeys.length)indexes=keys.flatMap((key,n)=>key&&!cp.beforeResponseKeys.includes(key)?[n]:[]);
  if(indexes.length!==1)return null;const n=indexes[0];if(keys[n])cp.responseKey=keys[n];cp.url=current;return replies.nth(n);
 }
 async downloadOriginal(p,button,{signal,dir}={}){
  const browser=p.context().browser(),session=await browser.newBrowserCDPSession(),pageSession=await p.context().newCDPSession(p),downloadDir=path.join(this.settings.tempDir||dir,'doubao-downloads',randomUUID());
  let guid,timer,onBegin,onProgress,onAbort;
  try{
   await fs.mkdir(downloadDir,{recursive:true});const {targetInfo}=await pageSession.send('Target.getTargetInfo'),{frameTree}=await pageSession.send('Page.getFrameTree');
   await session.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:downloadDir,eventsEnabled:true,...(targetInfo.browserContextId?{browserContextId:targetInfo.browserContextId}:{})});
   const completed=new Promise((resolve,reject)=>{onBegin=e=>{if(e.frameId===frameTree.frame.id)guid=e.guid;};onProgress=e=>{if(e.guid!==guid)return;if(e.state==='completed')resolve();else if(e.state==='canceled')reject(new Error('豆包原图下载取消，可继续原请求'));};onAbort=()=>reject(new Error('操作已停止'));session.on('Browser.downloadWillBegin',onBegin);session.on('Browser.downloadProgress',onProgress);signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>reject(new Error('豆包原图下载超时，可继续原请求')),30000);});
   // Track Chromium's real download GUID in our own directory. Other CDP
   // clients may have changed Playwright's shared artifact download path.
   await Promise.all([completed,button.click()]);if(!/^[a-f\d-]{36}$/i.test(guid||''))throw new Error('豆包原图下载标识无效');const file=path.join(downloadDir,guid),stat=await fs.stat(file);if(stat.size>30e6)throw new Error('插图超过30MB限制');const bytes=await fs.readFile(file);await fs.unlink(file);await fs.rmdir(downloadDir);return bytes;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);if(onBegin)session.off('Browser.downloadWillBegin',onBegin);if(onProgress)session.off('Browser.downloadProgress',onProgress);await pageSession.detach().catch(()=>{});await session.detach().catch(()=>{});}
 }
 async collect(p,item,ctx){
  const {dir,signal,progress,checkpoint}=ctx;let elapsed=0;while(elapsed<(this.settings.illustrationTimeoutMs||600000)){
   signal?.throwIfAborted();await this.checkQuota(p);await this.waitReady(p,ctx);const url=conversationUrl(p.url()),saved=conversationUrl(item.checkpoint.url);if(saved&&saved!==url)throw uncertain();if(url&&!saved){item.checkpoint.url=url;checkpoint();}
   const result=await this.resultFor(p,item);if(!result){progress('generating','等待原请求的可确认回复，未重复提交');await delay(this.pollMs,undefined,{signal});elapsed+=this.pollMs;continue;}checkpoint();const image=result.getByTestId('message_image_content').locator('[data-testid=mdbox_image]').first();
   if(await image.isVisible().catch(()=>false)&&await image.locator('xpath=ancestor::*[@data-testid="message_image_content"][1]').getAttribute('data-finished')==='true'){
    progress('downloading','图片已生成，正在下载原图');await image.hover();const button=result.getByTestId('edit_image_hover_tag_download_btn').first();
    const bytes=await this.downloadOriginal(p,button,{signal,dir});await fs.mkdir(dir,{recursive:true});const format=imageFormat(bytes),dimensions=imageDimensions(bytes),filename=item.id+'.'+format.ext;await fs.writeFile(path.join(dir,filename),bytes);item.checkpoint.phase='downloaded';checkpoint();return {filename,mime:format.mime,bytes:bytes.length,...dimensions,conversationUrl:p.url(),generationProvider:'doubao-ui',...(item.checkpoint.generationModel?{generationModel:item.checkpoint.generationModel}:{})};
   }
   // Never click a retry icon automatically: a failed request may still be processing.
   if(await p.getByTestId('message_box_failed_icon').isVisible().catch(()=>false))throw uncertain();
   progress('generating','豆包正在生成图片；已保存提交记录');await delay(this.pollMs,undefined,{signal});elapsed+=this.pollMs;
  }throw new Error('豆包图片等待超时，已保存原会话；继续时先检查已有结果');
 }
 async close(){if(this.owned)await this.context?.close();this.context=null;this.current=null;}
}
