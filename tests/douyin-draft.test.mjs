import test from 'node:test';
import assert from 'node:assert/strict';
import {getPlaywright} from '../src/config.mjs';
import {DouyinPublisher} from '../src/douyin-publisher.mjs';

const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=','base64');
async function fixture(browser,{loseCover=false}={}){
 const p=await browser.newPage();await p.route('https://fixture.test/**',r=>r.fulfill({contentType:'image/png',body:pixel}));
 await p.route('https://creator.douyin.com/web/api/media/aweme/draft',r=>r.fulfill({headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:JSON.stringify({status_code:0,draft:{creation_id:'fixture'}})}));
 await p.setContent(`<main></main><script>
 window.saved=0;window.reopened=0;window.published=0;
 window.render=()=>{document.querySelector('main').innerHTML=
 '<input placeholder="请输入文章标题，最多不超过30个字" value="主题">'+
 '<div class="tiptap" contenteditable="true"><p>正文。</p><div class="node-image"><img src="https://fixture.test/body.png"></div></div>'+
 '<section><div><div><span>文章头图</span></div></div><div><img src="https://fixture.test/head.png"></div></section>'+
 '<section><div><div><span>封面设置</span></div></div><div><img src="https://fixture.test/'+(${loseCover}&&window.reopened?'wrong':'cover')+'.png"></div></section>'+
 '<label class="semi-radio"><input type="radio" name="head" checked>有文章头图</label>'+
 '<label class="semi-radio"><input type="radio" name="head">无文章头图</label>'+
 '<button id="leave">暂存离开</button><button id="publish">发布</button>';
 document.querySelector('#publish').onclick=()=>window.published++;
 document.querySelector('#leave').onclick=async()=>{await fetch('https://creator.douyin.com/web/api/media/aweme/draft',{method:'POST'});window.saved++;document.querySelector('main').innerHTML='<button id="continue">继续编辑</button>';document.querySelector('#continue').onclick=()=>{window.reopened++;window.render();};};};window.render();</script>`);
 await p.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));return p;
}
function job(){return {document:{title:'主题',images:[{}],blocks:[{type:'text',text:'正文。'},{type:'image'}]},checkpoint:{headImageKey:'/head.png',coverImageKey:'/cover.png'}};}
test('头图与双列封面分别核验，缺头图或预览关闭时拒绝完成',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const p=await fixture(b),a=new DouyinPublisher(),j=job();await a.verifyCovers(p,j);assert.equal(j.verification.headImageVerified,true);
  await p.locator('label').filter({hasText:'无文章头图'}).click();await assert.rejects(a.verifyCovers(p,j),/未使用文章头图/);
  await p.locator('label').filter({hasText:'有文章头图'}).click();await p.getByText('文章头图',{exact:true}).locator('xpath=../../..').locator('img').evaluate(i=>i.remove());await assert.rejects(a.verifyCovers(p,j),/未完整保存/);
 }finally{await b.close();}
});
test('暂存后重开校验正文和两处封面，最终再次暂存离开而非停在编辑器',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const p=await fixture(b),a=new DouyinPublisher(),j=job();await a.saveDraft(p,j,{signal:new AbortController().signal,save(){},progress(){}});
  assert.deepEqual(await p.evaluate(()=>({saved,reopened,published})),{saved:2,reopened:1,published:0});
  assert.equal(await p.locator('.tiptap').count(),0);assert.equal(await p.getByText('继续编辑',{exact:true}).isVisible(),true);
  assert.equal(j.verification.images,1);assert.equal(j.verification.coverVerified,true);assert.ok(j.checkpoint.draftSavedAt);assert.ok(j.checkpoint.draftVerifiedAt);assert.ok(j.checkpoint.draftLeftAt);
 }finally{await b.close();}
});
test('重开后封面变更不会误记草稿核验完成，也不会点击发表',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const p=await fixture(b,{loseCover:true}),a=new DouyinPublisher(),j=job();await assert.rejects(a.saveDraft(p,j,{signal:new AbortController().signal,save(){},progress(){}}),/未完整保存/);
  assert.equal(j.checkpoint.draftSavedAt,undefined);assert.equal(j.checkpoint.draftLeftAt,undefined);assert.equal(await p.evaluate(()=>published),0);
 }finally{await b.close();}
});
test('替换图片时等待本次新媒体加载，不能把仍显示的旧图当作上传成功',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true});try{
  const p=await fixture(b),a=new DouyinPublisher();let done=false;
  const pending=a.waitCoverImage(p,'文章头图','/head.png').then(()=>{done=true;});
  await p.waitForTimeout(150);assert.equal(done,false);
  await p.getByText('文章头图',{exact:true}).locator('xpath=../../..').locator('img').evaluate(i=>i.src='https://fixture.test/new-head.png');
  await pending;assert.equal(done,true);
 }finally{await b.close();}
});
