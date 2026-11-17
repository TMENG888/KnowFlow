import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {CollectionCoverService,coverURL,normalizeCovers,observedCovers} from '../src/collection-covers.mjs';
import {visibleCandidates} from '../src/ui-navigation.mjs';
import {getPlaywright} from '../src/config.mjs';
import {extractDetail} from '../src/adapters.mjs';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=','base64');
test('全平台显式封面字段规范化；不把任意正文插图当封面',()=>{
 const rows=[['douyin',{video:{cover:{url_list:['https://img.test/d.jpg']}}}],['xiaohongshu',{cover:{urlDefault:'https://img.test/x.jpg'}}],['zhihu',{title_image:'https://img.test/z.jpg'}],['toutiao',{image_list:[{url:'https://img.test/t.jpg'}]}],['bilibili',{pic:'//img.test/b.jpg'}],['csdn',{cover_image:'https://img.test/c.jpg'}]];
 for(const [platform,raw]of rows)assert.equal(observedCovers(platform,raw).length,1,platform);
 assert.deepEqual(observedCovers('csdn',{cover:'https://g.csdnimg.cn/static/logo/202112131616291007.png'}),[]);assert.deepEqual(normalizeCovers({platform:'csdn',coverUrls:['https://g.csdnimg.cn/static/logo/202112131616291007.png']}).coverUrls,[]);assert.equal(coverURL('javascript:alert(1)'),null);assert.equal(coverURL('https://user:secret@img.test/x'),null);
 const i={platform:'zhihu',images:['https://img.test/body.jpg'],coverUrls:['//img.test/cover.jpg','https://img.test/cover.jpg']};normalizeCovers(i);assert.deepEqual(i.coverUrls,['https://img.test/cover.jpg']);assert.deepEqual(i.images,['https://img.test/body.jpg']);
 assert.deepEqual(normalizeCovers({platform:'csdn',images:['https://img.test/body.jpg']}).coverUrls,[]);
 const gallery={platform:'xiaohongshu',kind:'image',images:['https://img.test/first.jpg','https://img.test/second.jpg'],contentBlocks:[{type:'image',url:'https://img.test/first.jpg',placement:'gallery_order_only'}]};normalizeCovers(gallery);assert.equal(gallery.coverSource,'first_gallery_image');assert.equal(gallery.images.length,2);assert.equal(gallery.contentBlocks.length,1);
 const old={platform:'bilibili',extractionVersion:'bilibili-single-result-v1',images:['https://img.test/poster.jpg'],imageUrls:['https://img.test/poster.jpg']};normalizeCovers(old);assert.equal(old.coverSource,'legacy_bilibili_poster');assert.deepEqual(old.images,[]);assert.equal(old.coverUrls.length,1);normalizeCovers(old);assert.equal(old.coverUrls.length,1);
});
test('各平台详情把封面单独入字段，封面不追加进正文图片与语义分块',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const p=await b.newPage();p.waitForTimeout=async()=>{};
  const body='这是一段完整的主体知识内容，用来验证正文在封面独立存储之后仍然保持原有文字和语义分块信息。';
  for(const platform of ['douyin','xiaohongshu','toutiao','zhihu','csdn']){
   await p.setContent('<meta property="og:image" content="https://img.test/'+platform+'-cover.jpg"><h1>主题标题</h1><div id="content_views">'+body+'</div><article>'+body+'</article><div class="Post-RichTextContainer"><div class="RichText">'+body+'</div></div><div id="detail-desc">'+body+'</div><div data-e2e="video-desc">'+body+'</div>');
   const sourceId=platform==='zhihu'?'article-123':'123';
   const raw=platform==='douyin'?{aweme_id:'123',desc:body,video:{cover:{url_list:['https://img.test/'+platform+'-cover.jpg']}}}:platform==='xiaohongshu'?{noteId:'123',type:'normal',desc:body,cover:{urlDefault:'https://img.test/xiaohongshu-cover.jpg'}}:undefined;
   const item=await extractDetail(p,platform,{id:sourceId,url:'https://source.test/article',title:'主题',raw},{gate:async()=>{}},{alreadyOpened:true,openedObserver:{entities:[],flush:async()=>{}}});
   assert.equal(item.coverUrls[0],'https://img.test/'+platform+'-cover.jpg',platform);assert.deepEqual(item.images,[],platform);assert.equal(item.contentBlocks.filter(b=>b.type==='image').length,0,platform);
  }
 }finally{await b.close();}
});
test('按任务平台内容独立归档；并发去重、失败可重试且不覆盖更新的正文',async()=>{
 const dir=await fs.mkdtemp('E:/Codex/temp/knowflow-cover-archive-'),s=new Store(path.join(dir,'test.sqlite'));try{
  const taskId='11111111-1111-4111-8111-111111111111';s.saveTask({id:taskId,createdAt:new Date().toISOString()});
  const item={platform:'douyin',sourceId:'1',kind:'video',body:'旧正文',images:[],coverUrls:['https://img.test/a.jpg'],url:'https://www.douyin.com/video/1'};s.item(taskId,item);
  let calls=0,fail=true;const service=new CollectionCoverService(s,{outputDir:dir,download:async()=>{calls++;const fresh=s.items(taskId)[0];fresh.body='更新的正文';s.item(taskId,fresh);if(fail)throw new Error('HTTP 403');return {bytes:pixel,mime:'image/png'};}});
  const a=service.enqueue(taskId,item),b=service.enqueue(taskId,item);await Promise.all([a,b]);assert.equal(calls,1);assert.equal(s.items(taskId)[0].coverAssets[0].status,'failed');
  fail=false;service.backfill(taskId,{retry:true});await service.queue;const saved=s.items(taskId)[0],asset=saved.coverAssets[0];assert.equal(calls,2);assert.equal(saved.body,'更新的正文');assert.equal(asset.status,'completed');assert.ok(asset.file.startsWith('tasks/'+taskId+'/covers/douyin/'));assert.deepEqual(await fs.readFile(path.join(dir,asset.file)),pixel);assert.equal(saved.knowledge.blocks.filter(b=>b.type==='image').length,0);
  service.backfill(taskId);await service.queue;assert.equal(calls,2);
 }finally{s.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('搜索卡片只关联自身封面，排除头像且不混入相邻内容',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const p=await b.newPage();await p.route('https://img.test/**',r=>r.fulfill({contentType:'image/png',body:pixel}));await p.setContent('<div class="Search-container"><div class="List-item"><div class="AuthorInfo"><img src="https://img.test/avatar.jpg"></div><img src="https://img.test/cover1.jpg"><h2 class="ContentItem-title"><a href="https://zhuanlan.zhihu.com/p/123">第一篇</a></h2></div><div class="List-item"><h2 class="ContentItem-title"><a href="https://zhuanlan.zhihu.com/p/456">第二篇</a></h2></div></div>');
  const rows=await visibleCandidates(p,'zhihu',{flush:async()=>{},entities:[]});assert.deepEqual(rows[0].coverUrls,['https://img.test/cover1.jpg']);assert.deepEqual(rows[1].coverUrls,[]);
 }finally{await b.close();}
});

test('采集详情阶段在入库及转写前归档封面，随后入库不会重复下载；封面失败不阻断正文',async()=>{
 const dir=await fs.mkdtemp('E:/Codex/temp/knowflow-capture-cover-'),store=new Store(path.join(dir,'test.sqlite'));
 try{const id='11111111-1111-4111-8111-111111111111';let downloads=0;const service=new CollectionCoverService(store,{outputDir:dir,download:async url=>{downloads++;if(url.includes('fail'))throw new Error('下载暂时失败');return {bytes:pixel,mime:'image/png'};}});store.onItem=(task,item)=>service.enqueue(task,item);
 for(const platform of ['douyin','xiaohongshu','bilibili','zhihu','toutiao','csdn']){const item={platform,sourceId:'123',kind:'video',body:'完整正文',coverUrls:['https://img.test/'+platform+'.png'],images:[]};await service.capture(id,item);assert.equal(item.coverAssets[0].status,'completed');assert.equal(store.items(id).some(i=>i.platform===platform),false);assert.ok((await fs.stat(path.join(dir,item.coverAssets[0].file))).size);item.transcript='稍后完成的视频正文';store.item(id,item);}
 await service.queue;assert.equal(downloads,6);assert.equal(store.items(id).length,6);
 const failed={platform:'douyin',sourceId:'456',body:'正文保留',coverUrls:['https://img.test/fail.png'],images:[]};await service.capture(id,failed);assert.equal(failed.coverCapture.status,'failed');assert.equal(failed.body,'正文保留');store.item(id,failed);assert.equal(store.items(id).find(i=>i.sourceId==='456').coverAssets[0].status,'failed');
 assert.deepEqual(observedCovers('xiaohongshu',{imageList:[{urlDefault:'https://img.test/first-gallery.jpg'}]}),['https://img.test/first-gallery.jpg']);
 }finally{store.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('小红书采集使用本笔记卡片的真实封面，轮播隐藏克隆图及网站OG标志不混入封面',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const p=await b.newPage();p.waitForTimeout=async()=>{};const body='一篇可正常公开读取的知识文章，正文、图集顺序和封面各自独立保存，不用隐藏轮播克隆页作为笔记封面。';
  await p.setContent(`<meta property="og:image" content="https://img.test/site-logo.png"><h1>标题</h1><div id="detail-desc">${body}</div><a class="cover" href="https://www.xiaohongshu.com/explore/123"><img src="https://img.test/real-cover.jpg"></a><a class="cover" href="https://www.xiaohongshu.com/explore/456"><img src="https://img.test/neighbor.jpg"></a>`,{waitUntil:'domcontentloaded'});
  const raw={noteId:'123',desc:body,type:'normal',imageList:[{urlDefault:'https://img.test/clone-last.jpg'}]};
  const item=await extractDetail(p,'xiaohongshu',{id:'123',url:'https://www.xiaohongshu.com/explore/123',raw},{gate:async()=>{}},{alreadyOpened:true,openedObserver:{entities:[],flush:async()=>{}}});assert.deepEqual(item.coverUrls,['https://img.test/real-cover.jpg']);assert.ok(item.images.includes('https://img.test/clone-last.jpg'));
 }finally{await b.close();}
});
