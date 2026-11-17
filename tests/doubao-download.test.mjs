import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {DoubaoBrowser} from '../src/doubao-browser.mjs';import {config,getPlaywright} from '../src/config.mjs';
test('original download follows browser GUID despite another client overriding its artifact directory',async()=>{
 const b=await getPlaywright().chromium.launch({channel:'msedge',headless:true}),p=await b.newPage({acceptDownloads:true}),dir=path.join(config.tempDir,'doubao-download-tests',randomUUID()),adapter=new DoubaoBrowser({settings:{tempDir:dir}});await fs.mkdir(dir,{recursive:true});
 try{
  const data=Buffer.from('verified original download bytes');await p.setContent('<a download="original.png" href="data:application/octet-stream;base64,'+data.toString('base64')+'">下载原图</a>');
  const other=await b.newBrowserCDPSession();await other.send('Browser.setDownloadBehavior',{behavior:'deny'});await other.detach();
  let clicks=0;const button={click:async()=>{clicks++;await p.getByRole('link').click();}};const bytes=await adapter.downloadOriginal(p,button,{dir});assert.deepEqual(bytes,data);assert.equal(clicks,1);assert.equal((await fs.readdir(path.join(dir,'doubao-downloads'))).length,0);
  const second=await adapter.downloadOriginal(p,button,{dir});assert.deepEqual(second,data);assert.equal(clicks,2);
 }finally{await b.close();}
});
