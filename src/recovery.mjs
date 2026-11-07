import {createHash} from 'node:crypto';
import {canonical} from './domain.mjs';
import {PLATFORMS} from './config.mjs';
const COOKIE_NAMES={bilibili:['SESSDATA'],douyin:['sessionid','sessionid_ss'],xiaohongshu:['web_session'],zhihu:['z_c0'],csdn:['UserToken','UserName'],toutiao:['sessionid']};
export function readiness(current,baseline,{reason,until,expectedSource,now=Date.now()}={}){
 if(until&&now<Date.parse(until))return{ready:false,reason:'timed_protection_preserved'};
 if(expectedSource&&canonical('zhihu',current.url)?.id!==expectedSource)return{ready:false,reason:'awaiting_original_detail'};
 if(current.issue)return{ready:false,reason:'page_still_blocked'};
 if(current.results>0&&(!baseline.results||current.url!==baseline.url||baseline.issue||current.authFingerprint!==baseline.authFingerprint))return{ready:true,reason:'visible_search_results'};
 // An existing cookie alone is not proof of recovery. A new authenticated
 // session may authorize exactly one normal page retry after login/verification.
 if(current.auth&&current.authFingerprint!==baseline.authFingerprint)return{ready:true,reason:'authenticated_session_changed'};
 if(!baseline.auth&&current.auth)return{ready:true,reason:'login_session_created'};
 return{ready:false,reason:'awaiting_visible_recovery'};
}
export class RecoveryMonitor{
 constructor(browser,store,onReady){this.browser=browser;this.store=store;this.onReady=onReady;this.watches=new Map();this.tickTimer=setInterval(()=>this.tick(),5000);this.tickTimer.unref();}
 key(taskId,platform,channel='default'){return taskId+':'+platform+(channel==='default'?'':':'+channel);}
 async snapshot(page,platform){
  const cookies=await page.context().cookies();const selected=cookies.filter(c=>COOKIE_NAMES[platform]?.includes(c.name)&&PLATFORMS[platform].hosts.some(h=>c.domain.replace(/^\./,'')===h||c.domain.endsWith('.'+h)));
  const authFingerprint=createHash('sha256').update(selected.map(c=>c.name+':'+c.value).sort().join('|')).digest('hex');
  let issue=null;try{await this.browser.gate(page);}catch(e){issue=e.code||'page_unavailable';}
  const links=await page.locator('a[href]').evaluateAll(ns=>ns.map(n=>n.href)).catch(()=>[]);
  let resultCount=new Set(links.map(u=>canonical(platform,u)?.id).filter(Boolean)).size;
  if(platform==='douyin')resultCount+=await page.locator('div:has(> .videoImage)').count();
  const url=page.url(),isSearch=/\/search(?:_result|\/|\?|$)|so\.csdn\.net|search\.bilibili\.com/.test(url);
  const detail=canonical(platform,url);let hasDetail=false;
  if(detail)hasDetail=await page.locator('#content_views,article,.Post-RichTextContainer,.AnswerItem .RichText,#detail-desc,[data-e2e="video-desc"],video').count()>0;
  return{auth:selected.length>0,authFingerprint,issue,results:isSearch?resultCount:hasDetail?1:0,url};
 }
 async watch(taskId,platform,page,reason,{channel='default'}={}){
  const key=this.key(taskId,platform,channel);if(this.watches.has(key))return this.watches.get(key);
  const baseline=await this.snapshot(page,platform);const watch={taskId,platform,channel,page,reason,baseline,lastDecision:null,checking:false,ready:false,createdAt:new Date().toISOString()};
  const changed=()=>{clearTimeout(watch.debounce);watch.debounce=setTimeout(()=>this.check(watch),1200);watch.debounce.unref();};watch.changed=changed;page.on('framenavigated',changed);page.on('domcontentloaded',changed);this.watches.set(key,watch);return watch;
 }
 stop(taskId){for(const [key,w]of this.watches)if(w.taskId===taskId){w.page.off('framenavigated',w.changed);w.page.off('domcontentloaded',w.changed);clearTimeout(w.debounce);this.watches.delete(key);}}
 stopPlatform(taskId,platform){for(const[key,w]of this.watches)if(w.taskId===taskId&&w.platform===platform){w.page.off('framenavigated',w.changed);w.page.off('domcontentloaded',w.changed);clearTimeout(w.debounce);this.watches.delete(key);}}
 async tick(){for(const w of this.watches.values())await this.check(w);}
 async check(w){
  if(w.checking||w.ready||w.page.isClosed())return;const task=this.store.task(w.taskId);if(!task||task.stopRequested)return;
  w.checking=true;try{
   const current=await this.snapshot(w.page,w.platform),protection=this.store.protection(w.platform),decision=readiness(current,w.baseline,{reason:w.reason,until:protection?.until,expectedSource:w.channel==='detail'?canonical('zhihu',w.baseline.url)?.id:null});w.lastDecision=decision.reason;
   if(decision.ready){w.ready=true;await this.onReady(w,decision.reason);}
  }catch{}finally{w.checking=false;}
 }
 status(taskId){return[...this.watches.values()].filter(w=>w.taskId===taskId).map(w=>({platform:w.platform,channel:w.channel,reason:w.reason,ready:w.ready,lastDecision:w.lastDecision,open:!w.page.isClosed(),createdAt:w.createdAt}));}
 close(){clearInterval(this.tickTimer);for(const w of [...this.watches.values()])this.stop(w.taskId);}
}
