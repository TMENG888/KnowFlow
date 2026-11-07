import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {config,ROOT,PLATFORMS} from './config.mjs';
import {Store} from './store.mjs';
import {Engine} from './engine.mjs';
import {SCORING_VERSION} from './scoring.mjs';
import {canonical} from './domain.mjs';
import {extractDetail} from './adapters.mjs';
import {CreationService} from './creation.mjs';
import {DiscoveryService} from './discovery-service.mjs';
const lockPath=path.join(ROOT,'data','server.lock');let lock;
try{lock=await fs.open(lockPath,'wx');}catch(e){
 if(e.code!=='EEXIST')throw e;const old=JSON.parse(await fs.readFile(lockPath,'utf8'));let alive=false;try{process.kill(old.pid,0);alive=true;}catch{}
 if(alive)throw new Error('本平台服务已运行，拒绝重复启动');await fs.unlink(lockPath);lock=await fs.open(lockPath,'wx');
}
await lock.writeFile(JSON.stringify({pid:process.pid,port:config.port}));await lock.close();
const store=new Store(),engine=new Engine(store);engine.recover();
const creation=new CreationService(store,{scored:id=>engine.scored(id)}),discovery=await new DiscoveryService().init();
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.json':'application/json; charset=utf-8','.wav':'audio/wav'};
function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(typeof data==='string'?data:JSON.stringify(data));}
async function body(req,max=1000000){let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error('请求过大');parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}catch{throw new Error('请求内容不是有效JSON');}}
const csvCell=v=>{let s=v==null?'':String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return'"'+s.replaceAll('"','""')+'"';};
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${config.port}`&&req.headers.host!==`localhost:${config.port}`)return send(res,403,{error:'无效主机'});
  const url=new URL(req.url,'http://127.0.0.1'),p=url.pathname;
  if(req.method!=='GET'&&req.headers.origin&&!['http://127.0.0.1:'+config.port,'http://localhost:'+config.port].includes(req.headers.origin))return send(res,403,{error:'禁止跨站操作'});
  if(req.method==='GET'&&p==='/api/state')return send(res,200,{platforms:Object.entries(PLATFORMS).map(([id,p])=>({id,name:p.name,protection:store.protection(id)})),tasks:store.tasks(),running:engine.running,asrPolicy:{model:'Qwen/Qwen3-ASR-0.6B',backend:config.asrBackend,device:config.asrDevice,chunkSeconds:config.asrChunkSeconds,timestampType:'audio_chunk'},scorePolicy:{version:SCORING_VERSION,scope:'all-platforms/all-types',missingPolicy:'fixed-weight-no-redistribution',weights:config.scoreWeights,minCalibrationSize:config.minCalibrationSize,windowDays:90},version:'0.1.0'});
  if(req.method==='POST'&&p==='/api/tasks'){const input=await body(req);if(input.topicOrigin){const origin=discovery.selection(input.topicOrigin.discoveryId,input.topicOrigin.nodeId);if(input.keyword!==origin.keyword)throw new Error('选题词已修改，请重新选择选题或清除关联');input.topicOrigin=origin;}return send(res,201,engine.create(input));}
  if(req.method==='GET'&&p==='/api/creation-settings')return send(res,200,{configured:await creation.provider.configured(),model:creation.provider.model,embeddingModel:'BAAI/bge-small-zh-v1.5',localEmbedding:!!config.embeddingModel,scope:'task',active:creation.active});
  if(req.method==='POST'&&p==='/api/creation-settings'){const input=await body(req,4000);return send(res,200,await creation.provider.configure(String(input.key||'')));}
  if(req.method==='GET'&&p==='/api/creations')return send(res,200,{jobs:creation.list(),active:creation.active});
  if(req.method==='GET'&&p==='/api/creation-reference')return send(res,200,creation.recommend(url.searchParams.get('taskId')));
  if(req.method==='GET'&&p==='/api/reference-candidates')return send(res,200,{candidates:creation.candidates(url.searchParams.get('taskId'))});
  if(req.method==='POST'&&p==='/api/reference-candidates')return send(res,200,creation.candidate(await body(req,2000)));
  if(req.method==='POST'&&p==='/api/creations')return send(res,201,creation.publicJob(creation.create(await body(req,10000)).id));
  const creationRoute=p.match(/^\/api\/creations\/([a-f\d-]{36})(?:\/(prepare|generate|stop|save|export|review|section|history|analyze))?$/);
  if(creationRoute){const [,id,action]=creationRoute;
   if(req.method==='GET'&&!action)return send(res,200,creation.publicJob(id));
   if(req.method==='POST'&&['prepare','generate','analyze'].includes(action))return send(res,200,creation.start(id,action));
   if(req.method==='POST'&&action==='stop')return send(res,200,creation.stop(id));
   if(req.method==='POST'&&action==='save')return send(res,200,creation.publicJob(creation.save(id,(await body(req)).draft).id));
   if(req.method==='POST'&&action==='review')return send(res,200,creation.review(id,await body(req,12000)));
   if(req.method==='POST'&&action==='section'){const input=await body(req,2000);return send(res,200,creation.startSection(id,input.sectionId,input.action));}
   if(req.method==='GET'&&action==='history')return send(res,200,creation.history(id,url.searchParams.get('index')));
   if(req.method==='GET'&&action==='export')return url.searchParams.get('format')==='json'?send(res,200,creation.publicJob(id),{'Content-Disposition':'attachment; filename="creation-sources.json"'}):send(res,200,creation.export(id),{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="knowflow-draft.md"'});
  }
  if(req.method==='GET'&&p==='/api/discovery')return send(res,200,discovery.list());
  if(req.method==='POST'&&p==='/api/discovery')return send(res,201,await discovery.jobs.create(await body(req,12000)));
  if(req.method==='POST'&&p==='/api/discovery/import')return send(res,201,await discovery.jobs.import(await body(req,24000000)));
  if(req.method==='POST'&&p==='/api/discovery/import-legacy')return send(res,200,await discovery.importLegacy());
  if(req.method==='POST'&&p==='/api/discovery/browser'){const input=await body(req,2000);return send(res,200,input.close?await discovery.jobs.closeSession()||{closed:true}:await discovery.jobs.openSession(input.platform));}
  const discoveryRoute=p.match(/^\/api\/discovery\/([a-f\d-]{36})(?:\/(start|pause|continue|edit|selection|files\/.+))?$/);
  if(discoveryRoute){const [,id,action]=discoveryRoute;
   if(req.method==='GET'&&!action)return send(res,200,discovery.get(id));
   if(req.method==='POST'&&['start','pause','continue'].includes(action))return send(res,200,discovery.jobs[action](id));
   if(req.method==='POST'&&action==='edit')return send(res,200,await discovery.jobs.update(id,await body(req,12000)));
   if(req.method==='POST'&&action==='selection')return send(res,200,discovery.selection(id,(await body(req,2000)).nodeId));
   if(req.method==='GET'&&action?.startsWith('files/')){const name=decodeURIComponent(action.slice(6)),bytes=await discovery.file(id,name),html=name==='mindmap.html';res.writeHead(200,{'Content-Type':html?'text/html; charset=utf-8':name.endsWith('.csv')?'text/csv; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(html?{'Content-Security-Policy':"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"}:{'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name)})});return res.end(bytes);}
  }
  const taskRoute=p.match(/^\/api\/tasks\/([a-f\d-]+)(?:\/(retry|stop|export))?$/);
  if(taskRoute){const [,id,action]=taskRoute;const task=store.task(id);if(!task)return send(res,404,{error:'任务不存在'});
   if(req.method==='POST'&&action==='retry')return send(res,200,engine.retry(id,await body(req)));
   if(req.method==='POST'&&action==='stop')return send(res,200,engine.stop(id));
   if(req.method==='GET'&&action==='export'){
    const items=engine.scored(id);if(url.searchParams.get('format')==='csv'){
     const fields=['platform','sourceId','title','url','kind','author','publishedAt','body','transcript','contentStatus','transcriptStatus','imageUrls','videoUrl','videoUrls','resourceLinksObservedAt','videoUrlMayExpire','audioUrls','transcriptModel','bvid','cid','part','partTitle','metricsExtra'];const rows=[fields.concat(['likes','comments','favorites','shares','views','influence','scoreProvisional','metricCoverage','influenceRank','influenceRankN','scoreVersion','scoredWeight','scoreComponents']).map(csvCell).join(',')];
     for(const i of items)rows.push([...fields.map(k=>i[k]!==null&&typeof i[k]==='object'?JSON.stringify(i[k]):i[k]),...['likes','comments','favorites','shares','views'].map(k=>i.metrics[k]),i.influence?.score,i.influence?.provisional,i.influence?.metricCoverage,i.influence?.rank,i.influence?.rankN,i.influence?.version,i.influence?.scoredWeight,JSON.stringify(i.influence?.components||{})].map(csvCell).join(','));
     return send(res,200,'\uFEFF'+rows.join('\r\n'),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="content.csv"'});
    }return send(res,200,{task,items,events:store.events(id),detailQueue:store.detailJobs(id)},{'Content-Disposition':'attachment; filename="content.json"'});
   }
   if(req.method==='GET'&&!action)return send(res,200,{task,items:engine.scored(id),events:store.events(id),recovery:engine.recovery.status(id),detailQueue:store.detailJobs(id)});
  }
  if(req.method==='GET'&&p==='/api/platforms/zhihu/isolation'){
   const list=engine.browser.zhihuListPage,detail=engine.browser.zhihuDetailPage;
   const auth=async page=>page&&!page.isClosed()?(await page.context().cookies('https://www.zhihu.com')).some(c=>c.name==='z_c0'):null;
   return send(res,200,{separateContexts:!!list&&!!detail&&list.context()!==detail.context(),list:{url:list?.url(),authenticated:await auth(list),persistent:true,browserChannel:config.browserChannel},detail:{url:detail?.url(),authenticated:await auth(detail),persistent:true,profile:'independent_detail',executablePath:config.zhihuDetailExecutablePath||null,browserChannel:config.zhihuDetailExecutablePath?null:config.browserChannel,browserVersion:engine.browser.zhihuDetailBrowser?.version()},cookiesTransferred:false});
  }
  if(req.method==='POST'&&p==='/api/platforms/zhihu/check-public'){
   const active=engine.running&&store.task(engine.running)?.stages.find(s=>s.platform==='zhihu');if(active&&['searching','collecting'].includes(active.status))throw new Error('请等待知乎任务结束或安全停止后核验公开文章');
   const input=await body(req),source=canonical('zhihu',input.url);if(!source)throw new Error('仅支持真实知乎文章或回答链接');
   const protection=store.protection('zhihu');if(protection?.until&&Date.now()<Date.parse(protection.until))throw new Error('仍在保护等待期，未请求');
   const {list,detail}=await engine.browser.zhihuPages();let item=null,issue=null;
   try{await engine.browser.navigate(detail,input.url);item=await extractDetail(detail,'zhihu',source,engine.browser,{alreadyOpened:true});}catch(e){issue={code:e.code||'failed',message:e.message};}
   const evidence=await engine.evidence(detail,{id:'diagnostic-zhihu-isolation'},'zhihu','public-check');
   const result={at:new Date().toISOString(),url:detail.url(),separateContexts:list.context()!==detail.context(),detailAuthenticated:(await detail.context().cookies('https://www.zhihu.com')).some(c=>c.name==='z_c0'),cookiesTransferred:false,readable:!!item,title:item?.title,bodyChars:item?.body.length,imageCount:item?.imageUrls.length,issue,evidence};
   await fs.writeFile(path.join(config.outputDir,'zhihu-public-check.json'),JSON.stringify(result,null,2));return send(res,200,result);
  }
  if(req.method==='POST'&&p==='/api/platforms/zhihu/monitor-current'){
   const input=await body(req),task=store.task(input.taskId),page=engine.browser.zhihuDetailPage;
   if(!task||task.stopRequested||!task.platforms.includes('zhihu'))throw new Error('需要仍允许恢复的知乎任务');
   if(!page||page.isClosed())throw new Error('尚无已打开的详情窗口');
   const source=canonical('zhihu',page.url());if(!source||!store.detailJobs(task.id).some(j=>j.sourceId===source.id))throw new Error('当前详情必须属于任务已观察的真实链接队列');
   const active=engine.running&&store.task(engine.running)?.stages.find(s=>s.platform==='zhihu');if(active&&['searching','collecting'].includes(active.status))throw new Error('知乎正在运行');
   engine.recovery.stopPlatform(task.id,'zhihu');await engine.recovery.watch(task.id,'zhihu',page,'access_denied',{channel:'detail'});
   return send(res,200,{watching:true,networkRequestIssued:false,sourceId:source.id});
  }
  const login=p.match(/^\/api\/platforms\/([a-z]+)\/(login|refresh)$/);
  if(req.method==='POST'&&login&&PLATFORMS[login[1]]){
   const platform=login[1];if(login[2]==='login')return send(res,200,await engine.browser.login(platform));
   const protection=store.protection(platform);if(protection?.until&&Date.now()<Date.parse(protection.until))throw new Error('仍在平台保护等待期，未刷新页面');
   const stage=engine.running&&store.task(engine.running)?.stages.find(s=>s.platform===platform);if(stage&&['searching','collecting','transcribing'].includes(stage.status))throw new Error('该平台当前正在采集，请等待或安全停止后刷新');
   return send(res,200,await engine.browser.refresh(platform));
  }
  if(req.method==='GET'&&p.startsWith('/artifacts/')){
   const rel=decodeURIComponent(p.slice(11)),target=path.resolve(config.outputDir,rel);if(!target.startsWith(path.resolve(config.outputDir)+path.sep)||!rel.startsWith('tasks/')||!['.png','.wav','.json'].includes(path.extname(target)))return send(res,403,{error:'文件不可访问'});
   const bytes=await fs.readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)],'X-Content-Type-Options':'nosniff'});return res.end(bytes);
  }
  if(req.method==='GET'&&['/','/app.js','/style.css','/workflow.js','/workflow.css','/creation-canvas-model.js','/creation-canvas.js','/creation-canvas.css'].includes(p)){
   const file=path.join(ROOT,'public',p==='/'?'index.html':p.slice(1));const bytes=await fs.readFile(file);
   res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});return res.end(bytes);
  }
  send(res,404,{error:'未找到'});
 }catch(e){console.error('[request]',e.message);if(!res.headersSent)send(res,400,{error:e.code==='ENOENT'?'文件不存在':e.message});else res.end();}
});
server.listen(config.port,config.host,()=>console.log(`知流 KnowFlow http://${config.host}:${config.port}`));
server.on('error',e=>{console.error(e.message);fs.unlink(lockPath).catch(()=>{});process.exit(1);});
process.on('exit',()=>{try{import('node:fs').then(fs=>fs.unlinkSync(lockPath));}catch{}});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{if(engine.running)engine.stop(engine.running);if(creation.active)creation.stop(creation.active);await discovery.jobs.shutdown();server.close();fs.unlink(lockPath).finally(()=>process.exit(0));});
