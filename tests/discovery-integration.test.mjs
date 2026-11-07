import test from 'node:test';
import assert from 'node:assert/strict';
import {JobManager} from '../src/discovery/jobs.mjs';
import {DiscoveryService} from '../src/discovery-service.mjs';
import {createState,applyObservation} from '../src/discovery/core.mjs';
test('discovery selection verifies node ownership and preserves topic origin',()=>{const manager=new JobManager({dataDir:'unused',workDir:'unused'}),state=createState({seeds:['ReAct'],platforms:['douyin'],depth:1});applyObservation(state,state.nodes[0],{suggestions:['ReAct工具调用'],source:'dom',at:new Date().toISOString()});manager.jobs.set('job',{meta:{id:'job'},state,logs:[]});const discovery=new DiscoveryService({manager}),n=state.nodes.find(n=>n.depth===1);const origin=discovery.selection('job',n.id);assert.equal(origin.keyword,'ReAct工具调用');assert.equal(origin.depth,1);assert.deepEqual(origin.seeds,['ReAct']);assert.throws(()=>discovery.selection('job','forged'),/不属于/);assert.ok(discovery.get('job').nodes.length===2);});
test('discovery files reject path traversal before reading disk',async()=>{const discovery=new DiscoveryService({manager:{get(){throw new Error('must not reach storage');}}});await assert.rejects(discovery.file('job','../../settings.local.json'),/不可访问/);});
