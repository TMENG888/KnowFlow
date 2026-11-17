import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';
import {getPlaywright,config} from '../src/config.mjs';

function seed(store,platforms=['toutiao']){
 const task={id:randomUUID(),keyword:'fixture',createdAt:new Date().toISOString(),target:3,platforms,transcribeVideos:false,autoResumeAfterLogin:false,status:'completed',stages:platforms.map(platform=>({platform,status:'completed',target:3,accepted:3,failedDetails:0}))};
 for(const platform of platforms)for(let n=1;n<=3;n++)store.item(task.id,{platform,sourceId:String(n),kind:'article',title:'已采文章'+n,body:'既有完整正文',contentStatus:'completed',metrics:{},collectedAt:new Date().toISOString()});
 store.saveTask(task);return task;
}

test('raising 3 to 10 preserves saved content, detail queue and platform restrictions',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),task=seed(store,['toutiao','zhihu']);
 try{
  task.stages[1].status='access_denied';task.stages[1].message='40362';store.saveTask(task);
  store.queueDetail(task.id,{platform:'zhihu',sourceId:'queued',status:'blocked',url:'https://zhuanlan.zhihu.com/p/123'});
  store.protect('zhihu',{reason:'保护',until:'2099-01-01T00:00:00Z'});
  const before=store.items(task.id),queue=store.detailJobs(task.id),result=engine.updateTarget(task.id,{target:10});
  assert.equal(result.id,task.id);assert.equal(result.target,10);assert.equal(result.stages[0].status,'partial');assert.equal(result.stages[0].accepted,3);
  assert.ok(result.stages.every(s=>s.target===10));assert.equal(result.stages[1].status,'access_denied');assert.equal(result.stages[1].message,'40362');
  assert.deepEqual(store.items(task.id),before);assert.deepEqual(store.detailJobs(task.id),queue);assert.equal(store.protection('zhihu').reason,'保护');
 }finally{engine.recovery.close();store.close();}
});

test('invalid edits and changes while running leave the task and checkpoint unchanged',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),task=seed(store);
 try{
  for(const target of [0,2,101,NaN,3.5])assert.throws(()=>engine.updateTarget(task.id,{target}));
  assert.throws(()=>engine.updateTarget(task.id,{target:10,resume:'yes'}));
  engine.running=task.id;assert.throws(()=>engine.updateTarget(task.id,{target:10}),/安全停止/);
  assert.equal(store.task(task.id).target,3);assert.equal(store.items(task.id).length,3);
 }finally{engine.recovery.close();store.close();}
});

test('real browser resume after target edit only opens seven missing articles and reaches 10 without duplicates',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext();
 const old={pacing:config.pacing,readScrollSteps:config.readScrollSteps,outputDir:config.outputDir};
 const dir='E:/Codex/temp/20261108-knowflow-target-resume/'+randomUUID();await fs.mkdir(dir,{recursive:true});
 Object.assign(config,{pacing:{action:[0,0],read:[0,0],scroll:[0,0],key:[0,0]},readScrollSteps:0,outputDir:dir});
 const requested=[];
 context.on('page',page=>{const wait=page.waitForTimeout.bind(page);page.waitForTimeout=ms=>wait(Math.min(ms,10));});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url()),detail=/\/article\//.test(u.pathname);
  if(detail)requested.push(u.pathname);
  const cards=Array.from({length:10},(_,n)=>`<div class="cs-header"><a target="_blank" href="https://www.toutiao.com/article/${n+1}/">测试${n+1}</a></div>`).join('');
  await route.fulfill({contentType:'text/html; charset=utf-8',body:detail?'<h1>补采测试</h1><article class="article-content">这是本地拦截的完整正文测试，仅验证提高任务目标后的七条补采和去重行为，所有测试记录与生产任务完全隔离。</article>':`<form><input type="search"><button>搜索</button></form>${cards}<script>document.querySelector('form').onsubmit=e=>{e.preventDefault();history.pushState({},'', '/search?keyword=fixture');};</script>`});
 });
 const store=new Store(':memory:'),engine=new Engine(store),task=seed(store),before=store.items(task.id);
 engine.browser.open=async()=>context;engine.browser.workPage=async()=>context.newPage();
 let run;const original=engine.run.bind(engine);engine.run=(...args)=>(run=original(...args));
 try{
  engine.updateTarget(task.id,{target:10,resume:true});await run;
  const result=store.task(task.id),saved=store.items(task.id);
  assert.equal(result.status,'completed');assert.equal(result.stages[0].accepted,10);assert.equal(saved.length,10);
  assert.equal(requested.length,7);assert.ok(requested.every(p=>!['/article/1/','/article/2/','/article/3/'].includes(p)));
  for(const item of before)assert.deepEqual(saved.find(i=>i.sourceId===item.sourceId),item);
 }finally{engine.recovery.close();store.close();Object.assign(config,old);await browser.close();}
});

test('one platform can resume after manual recovery while another platform is still collecting',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext();
 const old={pacing:config.pacing,readScrollSteps:config.readScrollSteps,outputDir:config.outputDir};
 const dir='E:/Codex/temp/20261108-knowflow-platform-resume/'+randomUUID();await fs.mkdir(dir,{recursive:true});
 Object.assign(config,{pacing:{action:[0,0],read:[0,0],scroll:[0,0],key:[0,0]},readScrollSteps:0,outputDir:dir});
 let repaired=false,capturing=false,release;const hold=new Promise(r=>release=r),detailRequests=[];
 context.on('page',page=>{const wait=page.waitForTimeout.bind(page);page.waitForTimeout=ms=>wait(Math.min(ms,10));});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url()),csdn=u.hostname.includes('csdn'),detail=/\/article\//.test(u.pathname);
  if(!csdn&&!repaired){await route.fulfill({contentType:'application/json',body:JSON.stringify({error:{code:40362,message:'当前请求存在异常'}})});return;}
  if(detail)detailRequests.push(u.href);
  const text='这是本地测试完整文章，用于验证人工解决一个平台的异常后只恢复该平台，同时其他平台的采集进度与内容都不受到影响。';
  const html=detail?`<h1>平台断点恢复</h1>${csdn?'<div id="content_views">'+text+'</div>':'<article>'+text+'</article>'}`:`<form><input ${csdn?'id="toolbar-search-input"':'type="search"'}><button>搜索</button></form><div class="cs-header"><a target="_blank" href="${csdn?'https://blog.csdn.net/fixture/article/details/222':'https://www.toutiao.com/article/111/'}">断点测试</a></div><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();history.pushState({},'', '/search?${csdn?'q':'keyword'}=fixture');};</script>`;
  await route.fulfill({contentType:'text/html; charset=utf-8',body:html});
 });
 const store=new Store(':memory:'),engine=new Engine(store);
 engine.browser.open=async()=>context;engine.browser.workPage=async()=>context.newPage();
 const capture=engine.evidence.bind(engine);engine.evidence=async(page,task,platform,label)=>{if(platform==='csdn'){capturing=true;await hold;}return capture(page,task,platform,label);};
 let run;const original=engine.run.bind(engine);engine.run=(...args)=>(run=original(...args));
 const until=async predicate=>{const deadline=Date.now()+7000;while(!predicate()){assert.ok(Date.now()<deadline,'expected stage transition before timeout');await new Promise(r=>setTimeout(r,20));}};
 try{
  const task=engine.create({keyword:'fixture',target:1,platforms:['toutiao','csdn'],transcribeVideos:false,autoResumeAfterLogin:false});
  await until(()=>task.stages[0].status==='access_denied'&&capturing);
  const csdn=JSON.parse(JSON.stringify(task.stages[1]));
  repaired=true;engine.retry(task.id,{platforms:['toutiao']});
  await until(()=>task.stages[0].status==='completed');
  assert.equal(engine.running,task.id);assert.deepEqual(task.stages[1],csdn);assert.equal(store.items(task.id).filter(i=>i.platform==='toutiao').length,1);
  release();await run;assert.equal(task.status,'completed',JSON.stringify({stages:task.stages,errors:store.events(task.id).filter(e=>e.level==='warning')}));assert.equal(detailRequests.filter(u=>u.includes('csdn.net')).length,1);
 }finally{release();if(run)await run;engine.recovery.close();store.close();Object.assign(config,old);await browser.close();}
});
