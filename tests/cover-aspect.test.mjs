import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {CoverResearchService,coverAspectPolicy,matchesCoverAspect,COVER_RESEARCH_VERSION} from '../src/cover-research.mjs';
const png=(width,height,n)=>{const b=Buffer.alloc(256);b.write('\x89PNG\r\n\x1a\n',0,'binary');b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);b[255]=n;return b;};
const row=(id,score,platform='douyin')=>({sourceId:String(id),platform,title:'主题',url:'https://source.test/'+id,coverUrls:['https://images.test/'+id],influence:{score}});
const temp=()=>fs.mkdtemp('E:/Codex/temp/cover-aspect-');
test('按真实宽高匹配目标比例，允许缩放和少量缩略图取整，不把竖图一概当成3:4',()=>{
 const p=coverAspectPolicy('douyin');for(const [w,h] of [[1080,1440],[750,1000],[768,1024],[720,960],[756,1000]])assert.equal(matchesCoverAspect({width:w,height:h},p),true);
 for(const [w,h] of [[1920,1080],[900,1600],[1080,1080],[0,1000]])assert.equal(matchesCoverAspect({width:w,height:h},p),false);
 assert.equal(matchesCoverAspect({width:900,height:383},coverAspectPolicy('wechat')),true);assert.equal(matchesCoverAspect({width:1920,height:1080},coverAspectPolicy('wechat')),false);
});
test('首个封面地址比例不符时尝试同文后续地址，记录实际采用图的尺寸',async()=>{
 const service=new CoverResearchService({}, {download:async url=>({mime:'image/png',bytes:png(url.endsWith('wide')?1600:750,1000,1)})});
 const r=await service.load({...row(1,99),coverUrls:['https://images.test/wide','https://images.test/portrait']},{policy:coverAspectPolicy('douyin')});assert.equal(r.url,'https://images.test/portrait');assert.equal(r.width,750);assert.equal(r.height,1000);
});
test('高分横版与9:16被跳过，合格样本跨平台按影响力排名，SHA重复不凑数',async()=>{
 const dir=await temp();try{
 const rows=[row(1,100,'bilibili'),row(2,99),row(3,98,'xiaohongshu'),row(4,97,'bilibili'),row(5,96),row(6,95,'xiaohongshu'),row(7,94),row(8,93)];let calls=0;
 const service=new CoverResearchService({items:()=>rows},{settings:{outputDir:dir},prepare:async(i,f)=>fs.writeFile(f,i.bytes),download:async url=>{const n=Number(url.split('/').at(-1));return{mime:'image/png',bytes:png(n===1?1600:n===2?562:750,1000,n===4?3:n)};},provider:{analyzeCoverImages:async input=>{calls++;assert.equal(input.images.length,5);throw new Error('selection-complete');}}});
 const record={};await assert.rejects(service.analyze({id:'job',taskId:'task'},'douyin',record),/selection-complete/);assert.equal(calls,1);assert.deepEqual(record.coverResearch.references.map(r=>r.sourceId),['3','5','6','7','8']);assert.deepEqual(record.coverResearch.references.map(r=>r.score),[98,96,95,94,93]);assert.ok(record.coverResearch.references.every(r=>r.width===750&&r.height===1000));assert.equal(record.coverResearch.skipped.filter(s=>s.code==='COVER_ASPECT_MISMATCH').length,2);assert.ok(record.coverResearch.skipped.some(s=>s.reason==='重复图片'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('旧横版分析缓存不复用；匹配比例不足5张就等待，不用横图补齐也不调用模型',async()=>{
 const dir=await temp();try{let calls=0;const service=new CoverResearchService({items:()=>[row(1,100),row(2,90)]},{settings:{outputDir:dir},prepare:async(i,f)=>fs.writeFile(f,i.bytes),download:async url=>({mime:'image/png',bytes:png(url.endsWith('/1')?1600:750,1000,Number(url.at(-1)))}),provider:{analyzeCoverImages:async()=>{calls++;}}});
 const record={coverResearch:{version:COVER_RESEARCH_VERSION,status:'completed',channel:'douyin',references:Array.from({length:5},()=>({width:1600,height:900}))}};
 await assert.rejects(service.analyze({id:'job',taskId:'task'},'douyin',record),/1\/5.*3:4/);assert.equal(calls,0);assert.equal(record.coverResearch.status,'waiting_references');assert.equal(record.coverResearch.references.length,1);assert.equal(record.coverResearch.aspectPolicy.ratio,'3:4');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
