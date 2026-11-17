import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical} from '../src/domain.mjs';
import {bilibiliItem,extractBilibili} from '../src/bilibili.mjs';
import {Observer,BrowserManager,publicBilibiliPlayback,ensureOptionalBilibiliLoginGuard} from '../src/browser.mjs';
import {visibleCandidates} from '../src/ui-navigation.mjs';
import {getPlaywright} from '../src/config.mjs';
const bvid='BV14B2QB3EEj';
const video={bvid,title:'本地测试课程',pages:[{page:1,cid:11,duration:60,part:'第一段'},{page:2,cid:22,duration:90,part:'第二段'}],videos:2,stat:{like:0,reply:12,coin:3,danmaku:4},owner:{name:'测试作者'}};
test('B站单条搜索视频身份保留当前P且拒绝合集与伪域名',()=>{
 const first=canonical('bilibili',`https://www.bilibili.com/video/${bvid}/?spm_id_from=search`);assert.equal(first.id,bvid);assert.equal(first.part,1);
 const second=canonical('bilibili',`https://www.bilibili.com/video/${bvid}/?p=2`);assert.equal(second.id,bvid+'-p2');assert.equal(second.part,2);
 for(const url of ['https://space.bilibili.com/123/lists/22',`https://evilbilibili.com/video/${bvid}/`,`https://www.bilibili.com/video/${bvid}/?p=0`])assert.equal(canonical('bilibili',url),null);
});
test('只采被点击P的音轨和指标，不遍历剩余P、不把投币冒充分享',()=>{
 const candidate=canonical('bilibili',`https://www.bilibili.com/video/${bvid}/?p=2`);
 const item=bilibiliItem({candidate,video,dom:{url:candidate.url},playback:{dash:{audio:[{baseUrl:'https://media.example/current.m4a'}],video:[{baseUrl:'https://media.example/current.m4s'}]}}});
 assert.equal(item.cid,'22');assert.equal(item.durationSeconds,90);assert.equal(item.collectionScope.seriesExpanded,false);assert.equal(item.mediaUrl,'https://media.example/current.m4a');assert.equal(item.videoUrl,'https://media.example/current.m4s');assert.equal(item.metrics.likes,0);assert.equal(item.metrics.shares,null);assert.equal(item.metricsExtra.coins,3);
 assert.throws(()=>bilibiliItem({candidate,video:{...video,bvid:'BV0000000000'},dom:{url:candidate.url}}),/SOURCE_ID_UNCONFIRMED/);
 assert.throws(()=>bilibiliItem({candidate,video,dom:{url:candidate.url},playback:{is_preview:true}}),/预览/);
});
test('分段durl不能只拿第一段冒充完整视频',()=>{
 const candidate=canonical('bilibili',`https://www.bilibili.com/video/${bvid}/`);
 const item=bilibiliItem({candidate,video,dom:{url:candidate.url},playback:{durl:[{url:'https://media.example/part1'},{url:'https://media.example/part2'}]}});assert.equal(item.mediaUrl,null);assert.equal(item.videoUrls.length,2);
});
test('当前P没有匹配cid响应时不借用默认P的音轨',async()=>{
 const candidate=canonical('bilibili',`https://www.bilibili.com/video/${bvid}/?p=2`);
 const page={waitForTimeout:async()=>{},evaluate:async()=>({video,url:candidate.url,playback:{dash:{audio:[{baseUrl:'https://media.example/wrong-part'}]}}})};
 await assert.rejects(()=>extractBilibili(page,candidate,{gate:async()=>{}},{openedObserver:{flush:async()=>{},playbacks:[]}}),/BILIBILI_PART_PLAYBACK_UNCONFIRMED/);
});
test('只观察B站页面自己的播放响应并关联当前cid',async()=>{
 const page={on(){},off(){}};const observer=new Observer(page,'bilibili');
 await observer.consume({url:()=>`https://api.bilibili.com/x/player/wbi/playurl?bvid=${bvid}&cid=22`,headers:()=>({'content-type':'application/json'}),text:async()=>JSON.stringify({code:0,data:{dash:{audio:[{baseUrl:'https://media.example/track'}]}}})});assert.equal(observer.playbacks.length,1);assert.equal(observer.playbacks[0].cid,'22');observer.close();
});
test('B站搜索只取真实结果卡片，不收背景推荐与合集链接',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();await page.setContent(`<a href="https://www.bilibili.com/video/BV0000000000/">背景推荐</a><div class="bili-video-card"><a href="https://www.bilibili.com/video/${bvid}/">真实搜索结果</a></div><div class="bili-video-card"><a href="https://space.bilibili.com/123/lists/22">整套合集</a></div>`);
 const rows=await visibleCandidates(page,'bilibili',{flush:async()=>{},entities:[]});assert.equal(rows.length,1);assert.equal(rows[0].id,bvid);
 }finally{await browser.close();}
});
test('公开完整播放器的可选登录框正常关闭；预览和登录要求不绕过',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>本地测试视频</h1><video></video><div id="login"><button class="bili-mini-close-icon" onclick="document.querySelector('#login').remove()">关闭</button>扫码登录</div><div>请先登录或注册</div><script>window.__INITIAL_STATE__={videoData:{pages:[{page:1,duration:60}]}};window.__playinfo__={data:{dash:{audio:[]}}};Object.defineProperty(document.querySelector('video'),'duration',{value:60});Object.defineProperty(document.querySelector('video'),'readyState',{value:4});</script>`}));
 await page.goto(`https://www.bilibili.com/video/${bvid}/`);const manager=new BrowserManager();await manager.gate(page);assert.equal(await page.locator('.bili-mini-close-icon').count(),0);
 await page.evaluate(()=>window.__playinfo__.data.is_preview=true);assert.equal(await publicBilibiliPlayback(page),false);assert.match(await page.locator('body').innerText(),/请先登录/);await assert.rejects(()=>manager.gate(page),e=>e.code==='login_required');
 await page.route('https://search.bilibili.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="bili-video-card">公开搜索结果</div><div id="login"><button class="bili-mini-close-icon" onclick="document.querySelector('#login').remove()">关闭</button>扫码登录</div>`}));
 await page.goto('https://search.bilibili.com/all?keyword=fixture');await manager.gate(page);assert.equal(await page.locator('.bili-mini-close-icon').count(),0);
 }finally{await browser.close();}
});
test('登录框暂停播放器加载时先正常关闭，再核验公开播放状态',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>公开视频</h1><video></video><div id="login"><button class="bili-mini-close-icon">关闭</button>扫描二维码登录</div><script>document.querySelector('button').onclick=()=>{document.querySelector('#login').remove();window.__INITIAL_STATE__={videoData:{pages:[{page:1,duration:60}]}};window.__playinfo__={data:{dash:{audio:[]}}};Object.defineProperty(document.querySelector('video'),'duration',{value:60});Object.defineProperty(document.querySelector('video'),'readyState',{value:4});};</script>`}));
  await page.goto(`https://www.bilibili.com/video/${bvid}/`);assert.equal(await publicBilibiliPlayback(page),false);await new BrowserManager().gate(page);assert.equal(await page.locator('#login').count(),0);assert.equal(await publicBilibiliPlayback(page),true);
 }finally{await browser.close();}
});
test('操作过程中反复出现的登录遮罩均由网站关闭按钮消除',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>公开搜索结果</h1><div class="bili-video-card">结果</div><button id="read" onclick="window.reads=(window.reads||0)+1">读取</button>'}));await page.goto('https://search.bilibili.com/all?keyword=fixture');
  const actions=[];await ensureOptionalBilibiliLoginGuard(page,{log:(m,e)=>actions.push(e)});await new BrowserManager().gate(page);
  for(let n=0;n<3;n++){
   await page.evaluate(()=>{const modal=document.createElement('div');modal.id='login';modal.style='position:fixed;inset:0;background:#8888;z-index:9999';modal.innerHTML='<button class="bili-mini-close-icon">关闭</button>扫描二维码登录';modal.querySelector('button').onclick=()=>modal.remove();document.body.append(modal);});
   await page.locator('#read').click({timeout:4000});assert.equal(await page.locator('#login').count(),0);
  }
  assert.equal(await page.evaluate(()=>window.reads),3);assert.equal(actions.filter(a=>a.action==='dismiss_optional_login').length,3);
 }finally{await browser.close();}
});
test('弹幕输入框要求登录不会误报为视频正文必须登录，且不伪造完整播放确认',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>公开视频</h1><video></video><div class="bpx-player-video-inputbar unlogin">请先登录或注册\n弹幕礼仪\n发送</div>'}));await page.goto(`https://www.bilibili.com/video/${bvid}/`);assert.equal(await publicBilibiliPlayback(page),false);await new BrowserManager().gate(page);
  await page.evaluate(()=>{const prompt=document.createElement('p');prompt.innerText='请先登录后观看完整视频';document.body.append(prompt);});await assert.rejects(new BrowserManager().gate(page),e=>e.code==='login_required');
 }finally{await browser.close();}
});
test('关闭登录框后仍需登录则暂停，验证码保持原样等待人工处理',async()=>{
 const browser=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const page=await browser.newPage();let verification=false;await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>视频</h1><p>登录后查看完整内容</p><div id="login"><button class="bili-mini-close-icon" onclick="document.querySelector('#login').remove()">关闭</button>扫描二维码登录${verification?'<div class="geetest_panel">请完成安全验证</div>':''}</div>`}));const manager=new BrowserManager();
  await page.goto(`https://www.bilibili.com/video/${bvid}/`);await assert.rejects(manager.gate(page),e=>e.code==='login_required');assert.equal(await page.locator('#login').count(),0);
  verification=true;await page.reload();await assert.rejects(manager.gate(page),e=>e.code==='verification_required');assert.equal(await page.locator('#login').count(),1);
 }finally{await browser.close();}
});
