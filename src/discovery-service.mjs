import path from 'node:path';
import fs from 'node:fs/promises';
import {JobManager,EXPORTS} from './discovery/jobs.mjs';
import {config,ROOT} from './config.mjs';

export class DiscoveryService{
 constructor({manager=null,settings=config}={}){this.jobs=manager||new JobManager({dataDir:settings.discoveryDataDir||path.join(settings.outputDir,'discovery'),workDir:settings.discoveryWorkDir||path.join(ROOT,'private','discovery')});}
 async init(){await this.jobs.init();return this;}
 list(){return{jobs:this.jobs.list(),active:this.jobs.active,session:this.jobs.sessionInfo()};}
 get(id){return this.jobs.snapshot(this.jobs.get(id),{graph:true});}
 selection(id,nodeId){const j=this.jobs.get(id),n=j.state.nodes.find(n=>n.id===nodeId);if(!n)throw new Error('选题词不属于该联想任务');return{discoveryId:id,nodeId:n.id,keyword:n.term,platform:n.platform,depth:n.depth,seeds:j.state.config.seeds};}
 async file(id,name){if(!EXPORTS.has(name))throw new Error('不可访问此选题文件');const j=this.jobs.get(id);return fs.readFile(path.join(j.dir,name));}
 async importLegacy(){
  // Fixed local origin only: no user-controlled URL/file reads or shared browser profiles.
  let boot;try{const r=await fetch('http://127.0.0.1:4178/api/bootstrap',{signal:AbortSignal.timeout(5000),redirect:'error'});if(!r.ok)throw new Error();boot=await r.json();}catch{throw new Error('原选题工作台未在4178端口运行，可改用导入断点JSON');}
  const existing=new Set(this.jobs.list().map(j=>j.importedLegacyId).filter(Boolean)),imported=[],skipped=[];
  for(const old of (boot.jobs||[]).slice(0,100)){
   if(!/^[a-f\d-]{36}$/.test(old.id)||existing.has(old.id)||boot.active===old.id){skipped.push(old.id);continue;}
   const r=await fetch(`http://127.0.0.1:4178/api/jobs/${old.id}/files/checkpoint.json`,{signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw new Error('读取原选题断点失败，已导入记录会保留');const data=await r.text();if(data.length>24000000)throw new Error('原选题断点过大');
   const j=await this.jobs.import(JSON.parse(data)),stored=this.jobs.get(j.id);stored.meta.importedLegacyId=old.id;await this.jobs.persist(stored);imported.push(j.id);
  }return{imported,skipped};
 }
}
