import fs from 'node:fs/promises';
import path from 'node:path';
import {config,ROOT,getPlaywright} from './config.mjs';
import {runProcess} from './creation-provider.mjs';
import {verifyEditor} from './publication-editor.mjs';
import {publicationCoverFile} from './publication-cover-file.mjs';
import {waitPublicationReceipt} from './publication-receipt.mjs';

const entry='https://creator.douyin.com/creator-micro/content/upload?default-tab=5';
const manual=message=>Object.assign(new Error(message),{code:'PUBLISH_MANUAL'});
const coverSection=(page,title)=>page.getByText(title,{exact:true}).first().locator('xpath=../../..');
const imageKey=src=>{try{return new URL(src).pathname;}catch{return '';}};
export async function douyinCoverState(page){
 const read=async title=>coverSection(page,title).locator('img').evaluateAll(images=>images.filter(i=>i.complete&&i.naturalWidth>0).map(i=>({src:i.currentSrc||i.src,width:i.naturalWidth,height:i.naturalHeight})));
 const [head,cover]=await Promise.all([read('文章头图'),read('封面设置')]);
 return {head:head[0]||null,cover:cover[0]||null};
}
export class DouyinPublisher{
 constructor({settings=config,connect=null}={}){this.settings=settings;this.connect=connect;}
 async page(){if(this.current&&!this.current.isClosed())return this.current;
  if(!this.context){const pw=getPlaywright();if(this.connect||this.settings.publishingCdpEndpoint){this.browser=await(this.connect?this.connect():pw.chromium.connectOverCDP(this.settings.publishingCdpEndpoint,{timeout:15000}));this.context=this.browser.contexts()[0];}else{const profile=this.settings.publishingProfileDir||path.join(this.settings.profileDir,'douyin-publishing');this.context=await pw.chromium.launchPersistentContext(profile,{channel:this.settings.browserChannel||'msedge',headless:false,viewport:null,acceptDownloads:true});this.owned=true;}}
  this.current=this.context.pages().find(p=>p.url().startsWith('https://creator.douyin.com/'))||await this.context.newPage();return this.current;
 }
 async open(){const p=await this.page();if(!p.url().startsWith('https://creator.douyin.com/'))await p.goto(entry,{waitUntil:'domcontentloaded'});await p.bringToFront();return {url:p.url()};}
 async access(p){if(await p.getByText(/为保障账号安全，请先完成身份验证|拖动滑块|完成验证/).first().isVisible().catch(()=>false))throw Object.assign(new Error('请在抖音发布窗口手动完成身份验证，完成后点击继续发布'),{code:'PUBLISH_VERIFICATION'});if(await p.getByText('扫码登录',{exact:true}).isVisible().catch(()=>false))throw Object.assign(new Error('请在独立抖音发布窗口登录，完成后点击继续发布'),{code:'PUBLISH_LOGIN'});}
 async prepare(j,{dir,signal,save,progress}){
  const p=await this.page();await p.bringToFront();signal.throwIfAborted();if(j.checkpoint.preparedUrl&&p.url()!==j.checkpoint.preparedUrl)await p.goto(j.checkpoint.preparedUrl,{waitUntil:'domcontentloaded'});else if(!j.checkpoint.importRequestedAt&&!p.url().includes('/content/post/article'))await p.goto(entry,{waitUntil:'domcontentloaded'});await this.access(p);
  const file=path.join(dir,'article.docx');try{await fs.access(file);}catch{progress('document','正在生成包含全部正文与插画的导入文档');await runProcess(this.settings.publicationPython||this.settings.pythonExecutable,[path.join(ROOT,'src','publication_docx.py'),path.join(dir,'manifest.json'),file],'',{signal});}
  const resume=p.getByText('继续编辑',{exact:true});if(j.checkpoint.importRequestedAt&&await resume.isVisible().catch(()=>false))await resume.click();
  if(j.checkpoint.preparedUrl)await p.locator('.tiptap[contenteditable=true]').first().waitFor({state:'visible',timeout:60000});
  if(await p.locator('.tiptap[contenteditable=true]').count()){await this.verify(p,j);await this.fields(p,j,{dir,save,progress,signal});await this.saveDraft(p,j,{save,progress,signal});return;}
  if(j.checkpoint.importRequestedAt)throw manual('此前已上传导入文档，但当前不在原文章编辑器，请回到该草稿后继续，未重复导入');
  if(!p.url().includes('/content/upload'))await p.goto(entry,{waitUntil:'domcontentloaded'});await this.access(p);
  const start=p.getByText('一键导入',{exact:true});await start.waitFor({state:'visible',timeout:30000});if(!await p.locator('input[type=file][accept=".docx,.txt,.md"]').count())await start.click();const input=p.locator('input[type=file][accept=".docx,.txt,.md"]');await input.waitFor({state:'attached'});signal.throwIfAborted();
  j.checkpoint.importRequestedAt=new Date().toISOString();save();progress('importing','正在通过抖音“一键导入”上传全文与插画');await input.setInputFiles(file,{timeout:90000});await p.locator('.tiptap[contenteditable=true]').first().waitFor({state:'visible',timeout:90000});await this.access(p);await this.verify(p,j);await this.fields(p,j,{dir,save,progress,signal});await this.saveDraft(p,j,{save,progress,signal});
 }
 async verify(p,j){await p.waitForFunction(n=>[...document.querySelectorAll('.tiptap[contenteditable=true] .node-image img')].filter(i=>i.complete&&i.naturalWidth>0).length===n,j.document.images.length,{timeout:90000});const result=await verifyEditor(p,p.locator('.tiptap[contenteditable=true]'),j.document,'.node-image img');j.verification={...result,at:new Date().toISOString()};return result;}
 async fields(p,j,ctx){if(Array.from(j.document.title).length>30)throw manual('抖音文章标题最多30字符，请在发布窗口调整标题后新建发布副本');await p.getByPlaceholder('请输入文章标题，最多不超过30个字').fill(j.document.title);await this.cover(p,j,ctx);await this.topics(p,j,ctx);}
 async cover(p,j,{dir,save,progress,signal}){
  signal.throwIfAborted();const coverFile=await publicationCoverFile(j,dir);
  const current=await douyinCoverState(p),sameAsset=j.document.coverMode!=='ai'||j.checkpoint.coverSha256===j.document.coverAsset?.sha256;
  if(!sameAsset||!j.checkpoint.headImageReady||!current.head||imageKey(current.head.src)!==j.checkpoint.headImageKey){
   progress('head_image','正在上传首页推荐文章头图');
   const section=coverSection(p,'文章头图'),replace=section.getByText('点击替换图片',{exact:true});
   const chooser=p.waitForEvent('filechooser',{timeout:15000});
   await(await replace.isVisible()?replace:section.getByText('点击上传图片',{exact:true})).click();
   await(await chooser).setFiles(coverFile);
   const dialog=p.locator('.semi-modal-content:visible').filter({hasText:'图片编辑'});
   await dialog.getByRole('button',{name:'确定',exact:true}).click();
   await dialog.waitFor({state:'hidden',timeout:60000});
   await this.waitCoverImage(p,'文章头图',current.head?imageKey(current.head.src):'');
   const state=await douyinCoverState(p);j.checkpoint.headImageReady=true;j.checkpoint.headImageKey=imageKey(state.head.src);save();
  }
  const state=await douyinCoverState(p);
  if(!sameAsset||!j.checkpoint.coverReady||!state.cover||imageKey(state.cover.src)!==j.checkpoint.coverImageKey){
   progress('cover','正在设置双列展示封面');
   const complete=p.getByRole('button',{name:'完成',exact:true}),empty=p.getByText('点击上传封面图',{exact:true});
   if(!state.cover&&await empty.isVisible()){
    const chooser=p.waitForEvent('filechooser',{timeout:15000});await empty.click();await(await chooser).setFiles(coverFile);
   }else{
    await coverSection(p,'封面设置').getByText('编辑封面',{exact:true}).click();
    const chooser=p.waitForEvent('filechooser',{timeout:15000});await p.getByText('替换封面',{exact:false}).click();await(await chooser).setFiles(coverFile);
   }
   await complete.waitFor({state:'visible',timeout:30000});await complete.click();
   try{await complete.waitFor({state:'hidden',timeout:10000});}catch(e){await this.access(p);if(!await complete.isVisible()||await complete.getAttribute('class').then(c=>c.includes('loading')))throw e;await complete.click();await complete.waitFor({state:'hidden',timeout:30000});}
   await this.waitCoverImage(p,'封面设置',state.cover?imageKey(state.cover.src):'');const result=await douyinCoverState(p);
   j.checkpoint.coverReady=true;j.checkpoint.coverImageKey=imageKey(result.cover.src);save();
  }
  await p.locator('label.semi-radio').filter({hasText:'有文章头图'}).click();
  j.checkpoint.coverSha256=j.document.coverAsset?.sha256;
  await this.verifyCovers(p,j);save();
 }
 async waitCoverImage(p,title,previousKey=''){await coverSection(p,title).locator('img').first().waitFor({state:'attached',timeout:30000});await p.waitForFunction(({title,previousKey})=>{const label=[...document.querySelectorAll('span')].find(e=>e.textContent===title);const image=label?.parentElement?.parentElement?.parentElement?.querySelector('img');return image?.complete&&image.naturalWidth>0&&(!previousKey||new URL(image.currentSrc||image.src).pathname!==previousKey);},{title,previousKey},{timeout:60000});}
 async verifyCovers(p,j){
  const state=await douyinCoverState(p);
  if(!state.head||!state.cover||!j.checkpoint.headImageKey||!j.checkpoint.coverImageKey||imageKey(state.head.src)!==j.checkpoint.headImageKey||imageKey(state.cover.src)!==j.checkpoint.coverImageKey)throw manual('首页推荐头图或双列封面未完整保存，尚未通过草稿核验');
  if(!await p.locator('label.semi-radio').filter({hasText:'有文章头图'}).locator('input').isChecked())throw manual('首页推荐未使用文章头图，尚未通过草稿核验');
  j.verification={...j.verification,headImageVerified:true,coverVerified:true};return state;
 }
 async topics(p,j,{save,progress,signal}){const tags=j.document.tags||[],wanted=tags.map(t=>t.name);let modal=p.locator('.semi-modal-content:visible').filter({has:p.getByPlaceholder('搜索或输入你想添加的话题')});if(!await modal.count()){const edit=p.getByText('修改话题',{exact:true});if(await edit.isVisible())await edit.click();else if(tags.length)await p.getByText('点击添加话题',{exact:true}).click();else{j.checkpoint.tagsReady=true;save();return;}}
  const selected=()=>modal.locator('[class*=selectedTopicList] [class*=topicItem]');
  for(const item of await selected().all()){const name=(await item.locator('[class*=topicText]').innerText()).replace(/^#/,'').trim();if(!wanted.includes(name))await item.locator('[class*=removeIcon]').click();}
  for(const tag of tags){signal.throwIfAborted();const current=(await selected().locator('[class*=topicText]').allTextContents()).map(t=>t.replace(/^#/,'').trim());if(current.includes(tag.name))continue;progress('tags','正在添加精准话题 #'+tag.name);await modal.getByPlaceholder('搜索或输入你想添加的话题').fill(tag.name);const option=modal.locator('[class*=topicName]').filter({hasText:new RegExp('^#'+tag.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')});await option.first().waitFor({state:'visible',timeout:15000});await option.first().click();}
  const actual=(await selected().locator('[class*=topicText]').allTextContents()).map(t=>t.replace(/^#/,'').trim());if(actual.length!==wanted.length||wanted.some(t=>!actual.includes(t)))throw manual('平台话题与推荐标签不一致，未提交');await modal.getByRole('button',{name:/确认添加/}).click();j.checkpoint.addedTags=actual;j.checkpoint.tagsReady=true;save();
 }
 async saveDraft(p,j,{save,progress,signal}){
  signal.throwIfAborted();await this.verifyCovers(p,j);j.checkpoint.preparedUrl=p.url();save();
  const leave=async()=>{
   signal.throwIfAborted();const expectedId=new URL(j.checkpoint.preparedUrl).searchParams.get('creation_id');
   const response=p.waitForResponse(r=>r.request().method()==='POST'&&/\/web\/api\/media\/aweme\/draft\/?$/.test(new URL(r.url()).pathname)&&r.status()===200,{timeout:30000});
   await p.getByRole('button',{name:'暂存离开',exact:true}).click();
   const receipt=await(await response).json();
   if(!receipt.draft?.creation_id||expectedId&&receipt.draft.creation_id!==expectedId||receipt.status_code!=null&&receipt.status_code!==0)throw manual('未收到当前文章的草稿保存成功回执');
   j.checkpoint.draftSaveReceipt={creationId:receipt.draft.creation_id,at:new Date().toISOString()};save();
   await p.getByText('继续编辑',{exact:true}).waitFor({state:'visible',timeout:60000});if(await p.locator('.tiptap[contenteditable=true]').isVisible().catch(()=>false))throw manual('暂存后仍停留在编辑器，未确认离开');
  };
  progress('saving','正在暂存抖音图文并重新打开核对正文与两处封面');await leave();
  await p.getByText('继续编辑',{exact:true}).click();await p.locator('.tiptap[contenteditable=true]').waitFor({state:'visible',timeout:60000});await this.verify(p,j);
  await p.waitForFunction(title=>document.querySelector('input[placeholder="请输入文章标题，最多不超过30个字"]')?.value===title,j.document.title,{timeout:30000});
  await this.waitCoverImage(p,'文章头图');await this.waitCoverImage(p,'封面设置');await this.verifyCovers(p,j);
  j.checkpoint.preparedUrl=p.url();j.checkpoint.draftVerifiedAt=new Date().toISOString();save();
  progress('saving','全文与两处封面已核对，正在暂存并离开编辑器');await leave();
  j.checkpoint.draftSavedAt=new Date().toISOString();j.checkpoint.draftLeftAt=j.checkpoint.draftSavedAt;save();
 }
 async publish(j,ctx){const p=await this.page();await this.access(p);await this.verify(p,j);ctx.signal.throwIfAborted();await p.bringToFront();const button=p.getByRole('button',{name:'发布',exact:true});await button.scrollIntoViewIfNeeded();await button.waitFor({state:'visible'});if(!await button.isEnabled())throw manual('抖音发布按钮尚未就绪');ctx.beforeSubmit();await button.click();return waitPublicationReceipt(p,{channel:'douyin',title:j.document.title});}
 async close(){if(this.owned)await this.context?.close();else await this.browser?.close();this.current=this.context=this.browser=null;}
}
