import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {getPlaywright} from '../src/config.mjs';
import {CoverRecovery,readOriginalCovers} from '../src/cover-recovery.mjs';
import {CollectionCoverService} from '../src/collection-covers.mjs';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=','base64');
test('历史补取按当前原文与响应ID关联，排除推荐视频图片；重定向不回填',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const page=await browser.newPage();await page.route('https://www.douyin.com/**',r=>r.fulfill({contentType:'text/html',body:'<img src="data:image/png;base64,'+pixel.toString('base64')+'">'}));await page.goto('https://www.douyin.com/video/123');
  const item={platform:'douyin',sourceId:'123'};
  assert.deepEqual(await readOriginalCovers(page,item,[{aweme_id:'456',video:{cover:{url_list:['https://img.test/wrong.jpg']}}}]),[]);
  assert.deepEqual(await readOriginalCovers(page,item,[{aweme_id:'123',video:{cover:{url_list:['https://img.test/custom.jpg']},origin_cover:{url_list:['https://img.test/frame.jpg']}}},{aweme_id:'456',video:{cover:{url_list:['https://img.test/wrong.jpg']}}}]),['https://img.test/custom.jpg','https://img.test/frame.jpg']);
  await assert.rejects(readOriginalCovers(page,{...item,sourceId:'789'},[]),/身份不匹配/);
 }finally{await browser.close();}
});
test('补取缺失封面保存到当前记录，保留并发写入的正文、指标和正文图片；再次运行不重复',async()=>{
 const dir=await fs.mkdtemp('E:/Codex/temp/knowflow-cover-recovery-'),store=new Store(path.join(dir,'test.sqlite'));
 try{
  const taskId='11111111-1111-4111-8111-111111111111';store.saveTask({id:taskId,createdAt:new Date().toISOString()});store.item(taskId,{platform:'douyin',sourceId:'123',url:'https://www.douyin.com/video/123',body:'原正文',kind:'video',images:[],metrics:{likes:99},coverUrl:'https://expired.test/old.jpg',coverUrls:['https://expired.test/old.jpg'],coverAssets:[{url:'https://expired.test/old.jpg',status:'failed'}]});
  let closed=0,reads=0;const browser={open:async()=>({newPage:async()=>({close:async()=>closed++})}),navigate:async()=>{const current=store.items(taskId)[0];current.body='并发更新后的正文';store.item(taskId,current);}};
  const archive=new CollectionCoverService(store,{outputDir:dir,download:async()=>({bytes:pixel,mime:'image/png'})}),recovery=new CoverRecovery(store,{browser,archive,observer:()=>({entities:[],flush:async()=>{},close(){}}),read:async()=>{reads++;return ['https://img.test/custom.jpg'];}});
  recovery.start(taskId);assert.equal(recovery.start(taskId).alreadyRunning,true);await recovery.promise;const saved=store.items(taskId)[0];assert.equal(saved.body,'并发更新后的正文');assert.deepEqual(saved.images,[]);assert.equal(saved.metrics.likes,99);assert.equal(saved.coverAssets[0].status,'completed');assert.deepEqual(saved.coverUrls,['https://img.test/custom.jpg']);assert.equal(closed,1);assert.equal(recovery.last.completed,1);
  recovery.start(taskId);await recovery.promise;assert.equal(reads,1);assert.equal(recovery.last.total,0);
  recovery.isBusy=()=>true;assert.throws(()=>recovery.start(taskId),/停止后/);
 }finally{store.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('人工验证时保留页面并停止同平台后续补取，不把验证视为无封面',async()=>{
 const dir=await fs.mkdtemp('E:/Codex/temp/knowflow-cover-human-'),store=new Store(path.join(dir,'test.sqlite'));
 try{
  const taskId='11111111-1111-4111-8111-111111111111';store.saveTask({id:taskId,createdAt:new Date().toISOString()});for(const id of ['123','456'])store.item(taskId,{platform:'douyin',sourceId:id,url:'https://www.douyin.com/video/'+id,body:'正文',images:[]});let visits=0,closed=0;
  const browser={open:async()=>({newPage:async()=>({close:async()=>closed++})}),navigate:async()=>{visits++;throw Object.assign(new Error('请人工验证'),{code:'verification_required'});}},recovery=new CoverRecovery(store,{browser,archive:{},observer:()=>({close(){}})});
  recovery.start(taskId);await recovery.promise;assert.equal(visits,1);assert.equal(closed,0);assert.equal(store.items(taskId)[0].coverRecovery.status,'waiting_human');assert.equal(recovery.last.failed,2);assert.equal(recovery.last.done,2);
 }finally{store.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('小红书关闭普通登录弹窗后仍可读笔记，只取对应ID的封面，不回填通用OG标志',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const page=await browser.newPage(),id='6ae763230000000023012e34';await page.route('https://www.xiaohongshu.com/**',r=>r.fulfill({contentType:'text/html',body:`<meta property="og:image" content="https://img.test/site-logo.png"><a class="cover" href="/explore/wrong"><img src="https://img.test/recommendation.jpg"></a><a class="cover" href="/explore/${id}?xsec_source=pc_search"><img src="https://img.test/real-cover.jpg"></a>`}));await page.goto('https://www.xiaohongshu.com/explore/'+id,{waitUntil:'domcontentloaded'});
  assert.deepEqual(await readOriginalCovers(page,{platform:'xiaohongshu',sourceId:id},[]),['https://img.test/real-cover.jpg']);
  await page.locator('a.cover').evaluateAll(nodes=>nodes.forEach(e=>e.remove()));assert.deepEqual(await readOriginalCovers(page,{platform:'xiaohongshu',sourceId:id},[]),[]);
 }finally{await browser.close();}
});
