import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {config} from '../src/config.mjs';
const taskId=process.argv[2],base=`http://${config.host}:${config.port}`;
if(!taskId)throw new Error('Usage: node scripts/acceptance-check.mjs <task-id>');
const get=async url=>{const r=await fetch(base+url);assert.equal(r.status,200);return r;};
const blocked=await fetch(base+'/api/tasks',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403);
const badHost=await new Promise((resolve,reject)=>{http.get({hostname:config.host,port:config.port,path:'/api/state',headers:{Host:'example.invalid'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));}).on('error',reject);});assert.equal(badHost,403);
const traversal=await fetch(base+'/artifacts/tasks/%2e%2e%2f%2e%2e%2fsettings.json');assert.equal(traversal.status,403);
const data=await(await get('/api/tasks/'+taskId+'/export?format=json')).json(),csv=await(await get('/api/tasks/'+taskId+'/export?format=csv')).text();
assert.ok(csv.includes('imageUrls')&&csv.includes('videoUrl')&&csv.includes('videoUrls'));
for(const item of data.items){assert.ok(Array.isArray(item.imageUrls));assert.ok(Array.isArray(item.videoUrls));assert.ok(item.url.startsWith('https://'));assert.ok(['visible_result_click','observed_result_link_handoff'].includes(item.navigationEvidence?.method));if(item.navigationEvidence?.method==='observed_result_link_handoff')assert.equal(item.navigationEvidence.cookiesTransferred,false);if(item.kind==='video'&&item.contentStatus==='completed')assert.equal(item.transcriptStatus,'completed');}
for(const item of data.items.filter(i=>i.platform==='zhihu'&&i.contentStatus==='completed'))assert.equal(item.navigationEvidence.resultScope,'primary_search_result');
for(const item of data.items.filter(i=>i.contentStatus==='excluded'))assert.equal(item.influence,null);
await fs.writeFile(config.outputDir+'/acceptance-check.json',JSON.stringify({at:new Date().toISOString(),taskId,badOrigin:403,badHost,pathTraversal:403,exportFields:true,uiClickEvidence:true,items:data.items.length},null,2));
console.log('ACCEPTANCE_CHECK_PASSED');
