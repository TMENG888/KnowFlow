import {getPlaywright,config,PLATFORMS} from './config.mjs';
import {classifyAccess} from './domain.mjs';
export class AccessError extends Error{constructor(issue){super(issue.message);Object.assign(this,issue);}}
export async function publicBilibiliPlayback(page){
 if(!/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}\//.test(page.url()))return false;
 return page.evaluate(()=>{const v=window.__INITIAL_STATE__?.videoData,p=window.__playinfo__?.data;const part=Number(new URL(location.href).searchParams.get('p')||1);const duration=v?.pages?.find(p=>Number(p.page)===part)?.duration;const player=document.querySelector('video');return!!v&&!!p&&!p.is_preview&&!p.isPreview&&!v.rights?.pay&&!v.is_upower_exclusive&&duration>0&&player?.readyState>=1&&player.duration>=duration-3;}).catch(()=>false);
}
export async function dismissOptionalBilibiliLogin(page){
 const publicResults=/^https:\/\/search\.bilibili\.com\//.test(page.url())&&await page.locator('.bili-video-card:visible,.video-list .video-item:visible').count()>0;
 if(!publicResults&&!await publicBilibiliPlayback(page))return false;
 const close=page.locator('.bili-mini-close-icon:visible').first();if(!await close.count())return false;
 await close.click({timeout:8000});await page.waitForTimeout(400);return true;
}
export function zhihuBrowserOptions(role,settings=config){
 const options={headless:settings.headless,downloadsPath:settings.tempDir};
 if(role==='detail'&&settings.zhihuDetailExecutablePath)options.executablePath=settings.zhihuDetailExecutablePath;
 else options.channel=settings.browserChannel;
 return options;
}
export function zhihuDetailProfile(settings=config){
 const dir=settings.zhihuDetailProfileDir;if(!dir||dir===settings.zhihuListProfileDir||dir===settings.profileDir)throw new Error('知乎详情必须配置独立持久化资料目录');return dir;
}
export async function dismissOptionalZhihuLogin(page){
 if(!/^https:\/\/(?:www|zhuanlan)\.zhihu\.com\/(?:p\/\d+|question\/\d+\/answer\/\d+)/.test(page.url()))return false;
 const modal=page.locator('.SignFlowModal:visible,.signFlowModal:visible');if(!await modal.count())return false;
 const content=page.locator('.Post-RichTextContainer,.AnswerItem .RichContent-inner').first();
 if(!await content.count()||(await content.innerText().catch(()=>'')).trim().length<25)return false;
 const close=page.locator('.Modal-wrapper:has(.SignFlowModal) button.Modal-closeButton:visible,.Modal-wrapper:has(.signFlowModal) button.Modal-closeButton:visible,.SignFlowModal button[aria-label="关闭"]:visible,.signFlowModal button[aria-label="关闭"]:visible').first();
 if(!await close.count())return false;await close.click({timeout:8000});await page.waitForTimeout(400);return !await modal.count();
}
export class BrowserManager{
 constructor({chromium=null,settings=config}={}){this.chromium=chromium;this.settings=settings;this.browser=null;this.context=null;this.connecting=null;this.loginPages=new Map();this.navigations=new WeakMap();}
 forgetContext(context){
  if(this.context!==context)return;
  this.context=null;this.browser=null;
  for(const [platform,page]of this.loginPages)if(page.isClosed()||page.context()===context)this.loginPages.delete(platform);
 }
 async open(){
  if(this.context){const browser=this.context.browser();if(!browser||browser.isConnected())return this.context;this.forgetContext(this.context);}
  if(this.connecting)return this.connecting;
  this.connecting=(async()=>{
   const chromium=this.chromium||getPlaywright().chromium,settings=this.settings;
   let context,browser;
   if(settings.browserCdpEndpoint){try{browser=await chromium.connectOverCDP(settings.browserCdpEndpoint,{timeout:2500});context=browser.contexts()[0];}catch{browser=null;}}
   if(!context){context=await chromium.launchPersistentContext(settings.profileDir,{channel:settings.browserChannel,headless:settings.headless,locale:'zh-CN',timezoneId:'Asia/Shanghai',viewport:{width:1440,height:960},downloadsPath:settings.tempDir});browser=context.browser();}
   context.setDefaultNavigationTimeout(settings.navigationTimeoutMs);context.setDefaultTimeout(9000);
   this.context=context;this.browser=browser;
   context.on('close',()=>this.forgetContext(context));
   browser?.on('disconnected',()=>this.forgetContext(context));return context;
  })();try{return await this.connecting;}finally{this.connecting=null;}
 }
 async login(platform){const context=await this.open();let page=this.loginPages.get(platform);
  if(platform==='zhihu'&&config.zhihuIsolation){const pages=await this.zhihuPages();if(pages.list.url()==='about:blank')await this.navigate(pages.list,PLATFORMS.zhihu.home).catch(()=>{});await pages.list.bringToFront();return{opened:true,platform,channel:'list',message:'已打开知乎列表专用登录浏览器；详情浏览器保持未登录，登录后列表任务自动恢复'};}
  if(!page||page.isClosed()||page.context()!==context){page=await this.newPlatformPage(platform);this.loginPages.set(platform,page);await this.navigate(page,PLATFORMS[platform].home).catch(()=>{});}
  await page.bringToFront();return{opened:true,platform,message:'请在独立浏览器内完成登录，然后点击重试未完成平台。'};
 }
 async workPage(platform){
  const context=await this.open();let page=this.loginPages.get(platform);
  if(!page||page.isClosed()||page.context()!==context){
   const candidates=context.pages().filter(p=>{try{const u=new URL(p.url());return PLATFORMS[platform].hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))&&!/\/404|\/website-login\/error|\/account\/unhuman/.test(u.pathname);}catch{return false;}});
   page=candidates.at(-1)||(this.settings.platformWindows?await this.newPlatformPage(platform):await context.newPage());this.loginPages.set(platform,page);
  }
  return page;
 }
 async newPlatformPage(platform){
  const context=await this.open();if(!this.settings.platformWindows)return context.newPage();
  // Always use the browser owning this context, never a cached CDP connection from an earlier launch.
  const browser=context.browser();if(!browser)return context.newPage();
  const cdp=await browser.newBrowserCDPSession();
  try{
   const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank',newWindow:true,background:true});
   for(let attempt=0;attempt<30;attempt++){
    for(const page of context.pages()){
     if(page.isClosed())continue;
     const session=await context.newCDPSession(page);let info;try{info=await session.send('Target.getTargetInfo');}finally{await session.detach().catch(()=>{});}
     if(info.targetInfo.targetId===targetId){await page.setViewportSize({width:1280,height:900});return page;}
    }
    await new Promise(r=>setTimeout(r,100));
   }
   throw new Error('独立平台窗口未就绪：'+platform);
  }finally{await cdp.detach().catch(()=>{});}
 }
 async refresh(platform){const page=platform==='zhihu'&&config.zhihuIsolation?(await this.zhihuPages()).detail:await this.workPage(platform);await page.reload({waitUntil:'domcontentloaded',timeout:config.navigationTimeoutMs});await page.bringToFront();try{await this.gate(page);return{refreshed:true,message:'已刷新一次；正在核验页面恢复，受阻任务保留原断点'};}catch(e){return{refreshed:true,code:e.code,message:e.message};}}
 async zhihuPages(){
  if(this.zhihuOpening)return this.zhihuOpening;
  this.zhihuOpening=(async()=>{
   const {chromium}=getPlaywright();
   if(!this.zhihuListContext){this.zhihuListContext=await chromium.launchPersistentContext(config.zhihuListProfileDir,{...zhihuBrowserOptions('list'),viewport:{width:1280,height:900},locale:'zh-CN'});this.zhihuListContext.on('close',()=>{this.zhihuListContext=null;this.zhihuListPage=null;});}
   if(!this.zhihuListPage||this.zhihuListPage.isClosed())this.zhihuListPage=this.zhihuListContext.pages()[0]||await this.zhihuListContext.newPage();
   if(!this.zhihuDetailContext){this.zhihuDetailContext=await chromium.launchPersistentContext(zhihuDetailProfile(),{...zhihuBrowserOptions('detail'),viewport:{width:1280,height:900},locale:'zh-CN'});this.zhihuDetailBrowser=this.zhihuDetailContext.browser();this.zhihuDetailContext.on('close',()=>{this.zhihuDetailContext=null;this.zhihuDetailPage=null;});}
   if(!this.zhihuDetailPage||this.zhihuDetailPage.isClosed())this.zhihuDetailPage=this.zhihuDetailContext.pages()[0]||await this.zhihuDetailContext.newPage();
   const auth=await this.zhihuDetailContext.cookies('https://www.zhihu.com');if(auth.some(c=>c.name==='z_c0'))throw new AccessError({code:'access_denied',message:'详情专用浏览器检测到登录态，请退出该窗口的登录后继续；未自动清理Cookie'});
   return{list:this.zhihuListPage,detail:this.zhihuDetailPage,listContext:this.zhihuListContext,detailContext:this.zhihuDetailContext};
  })();try{return await this.zhihuOpening;}finally{this.zhihuOpening=null;}
 }
 async gate(page,status=200){
  if(status<400)await dismissOptionalBilibiliLogin(page);
  const snapshot={url:page.url(),title:await page.title(),text:await page.locator('body').innerText({timeout:8000}).catch(()=>''),status};
  const classify=async()=>{
   let text=snapshot.text;
   if(/^https:\/\/(?:www|zhuanlan)\.zhihu\.com\/(?:p\/\d+|question\/\d+\/answer\/\d+)/.test(snapshot.url)&&await page.locator('.Post-RichTextContainer,.AnswerItem .RichContent-inner').count())text=text.replace(/请您登录后查看更多专业优质内容[。！!]?/g,'');
   if(await publicBilibiliPlayback(page))text=text.replace(/请先登录或注册/g,'');
   return classifyAccess({...snapshot,text});
  };
  let issue=await classify();if(issue&&issue.code!=='login_required')throw new AccessError(issue);
  if(await dismissOptionalZhihuLogin(page)){snapshot.text=await page.locator('body').innerText();issue=await classify();}
  if(issue)throw new AccessError(issue);
  if(await page.locator('.passport-login-container:visible iframe[src*="passport.csdn.net/account/login"],.SignFlowModal:visible,.signFlowModal:visible,.login-container:visible,.login-modal:visible,.bili-mini-close-icon:visible').count())throw new AccessError({code:'login_required',message:'平台显示登录窗口，请在保留的浏览器页面完成登录'});return snapshot;
 }
 async navigate(page,url){const active=this.navigations.get(page);if(active?.url===url)return active.promise;if(active)await active.promise.catch(()=>{});const job={url};job.promise=(async()=>{const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:config.navigationTimeoutMs});await page.waitForTimeout(2200);return this.gate(page,r?.status()||200);})();this.navigations.set(page,job);try{return await job.promise;}finally{if(this.navigations.get(page)===job)this.navigations.delete(page);}}
}
export function decodePayload(text){
 try{return[JSON.parse(text)];}catch{}
 const values=[];let start=-1,depth=0,inString=false,escape=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(start<0){if(c==='{'){start=i;depth=1;}continue;}if(inString){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')inString=false;continue;}if(c==='"')inString=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{values.push(JSON.parse(text.slice(start,i+1)));}catch{}start=-1;}}
 return values;
}
export function walk(value,visit){const stack=[[value,0]];let visited=0;while(stack.length&&visited++<12000){const [node,depth]=stack.pop();if(!node||typeof node!=='object'||depth>16)continue;visit(node);for(const child of Object.values(node))if(child&&typeof child==='object')stack.push([child,depth+1]);}}
export class Observer{
 constructor(page,platform,{purpose='detail',keyword=null}={}){this.platform=platform;this.purpose=purpose;this.keyword=keyword;this.entities=[];this.playbacks=[];this.pending=new Set();this.access=null;this.searchResponses=0;
  this.listener=response=>{const job=this.consume(response).catch(()=>{}).finally(()=>this.pending.delete(job));this.pending.add(job);};page.on('response',this.listener);this.page=page;
 }
 async consume(response){
  let u;try{u=new URL(response.url());}catch{return;}
  if(!PLATFORMS[this.platform].hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return;
  if(this.purpose==='search'&&!/search/i.test(u.pathname))return;
  if(this.purpose==='search'&&this.platform==='douyin'&&!/\/general\/search/.test(u.pathname))return;
  if(this.purpose==='search'&&this.platform==='douyin'&&this.keyword){let keyword=u.searchParams.get('keyword');if(!keyword){const body=response.request().postData()||'';try{keyword=JSON.parse(body).keyword;}catch{keyword=new URLSearchParams(body).get('keyword');}}if(keyword!==this.keyword)return;}
  if(this.purpose==='search'&&this.platform==='bilibili'&&this.keyword&&u.searchParams.get('keyword')!==this.keyword)return;
  if(!/(search|detail|feed|article|content|note|playurl|web-interface\/.*view)/i.test(u.pathname)||!/json|text\/plain/i.test(response.headers()['content-type']||''))return;
  const length=Number(response.headers()['content-length']||0);if(length>5e6)return;
  const text=await Promise.race([response.text(),new Promise(r=>{const t=setTimeout(()=>r(''),10000);t.unref();})]);if(text.length>5e6)return;
  for(const data of decodePayload(text)){
   if(this.platform==='bilibili'){
    if([-352,-412,-509].includes(Number(data.code)))this.access={code:'risk_controlled',message:'B站页面响应要求安全保护，状态码 '+data.code,cooldownMs:7200000};
    if(/playurl/.test(u.pathname)&&data.code===0&&data.data)this.playbacks.push({cid:u.searchParams.get('cid'),bvid:u.searchParams.get('bvid'),data:data.data});
   }
   if(this.purpose==='search')this.searchResponses++;
   const issue=responseIssue(data);if(issue)this.access=issue;
   if([300012,300013].includes(data.code))this.access={code:'risk_controlled',message:'平台返回安全限制 '+data.code,cooldownMs:7200000};
   walk(data,v=>{if(this.entities.length>=800)return;
    if(this.platform==='douyin'&&v.aweme_id&&v.author&&v.desc!=null)this.entities.push(v);
    if(this.platform==='xiaohongshu'&&(v.noteId||v.note_id)&&(v.desc!=null||v.title))this.entities.push(v);
    if(this.platform==='zhihu'&&v.id&&(v.type==='answer'||v.type==='article')&&(v.content||v.excerpt))this.entities.push(v);
    if(this.platform==='toutiao'&&(v.group_id||v.item_id)&&v.title)this.entities.push(v);
    if(this.platform==='bilibili'&&v.bvid&&v.title)this.entities.push(v);
   });
  }
 }
 async flush(){await Promise.allSettled([...this.pending]);if(this.access)throw new AccessError(this.access);}
 close(){this.page.off('response',this.listener);}
}
export function responseIssue(data){
 if(Number(data.error?.code)===40362)return{code:'access_denied',message:'知乎返回访问保护 40362：暂时限制本次访问'};
 if(/verify|captcha/i.test(String(data.search_nil_info?.search_nil_type||'')+' '+String(data.search_nil_info?.search_nil_item||'')))return{code:'verification_required',message:'搜索响应要求人工验证（verify_check），空列表不代表没有内容'};
 if([300012,300013].includes(data.code))return{code:'risk_controlled',message:'平台返回安全限制 '+data.code,cooldownMs:7200000};
 if(data.status_code!=null&&Number(data.status_code)!==0)return{code:'access_denied',message:'平台搜索或详情响应异常，状态码 '+data.status_code};
 return null;
}
