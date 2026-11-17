import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DeepSeekProvider,runProcess} from '../src/creation-provider.mjs';
import {config} from '../src/config.mjs';
test('execution policy errors have a safe diagnostic without echoing raw process output',async()=>{
 await assert.rejects(runProcess(process.execPath,['-e','process.stderr.write("PSSecurityException about_Execution_Policies PRIVATE_SENTINEL");process.exit(1)'],''),e=>e.code==='POWERSHELL_SCRIPT_BLOCKED'&&e.exitCode===1&&!e.message.includes('PRIVATE_SENTINEL'));
});
test('a blocked credential helper never reaches the API and is not reported as a missing key',async()=>{
 let requests=0;const p=new DeepSeekProvider({fetchImpl:async()=>{requests++;}});p.secret=async()=>{throw Object.assign(new Error('private stderr'),{code:'POWERSHELL_SCRIPT_BLOCKED'});};
 await assert.rejects(p.verify(),e=>e.code==='POWERSHELL_SCRIPT_BLOCKED'&&/执行策略/.test(e.message)&&!/未配置|private stderr/.test(e.message));assert.equal(requests,0);
});
test('a local helper runs under RemoteSigned even when its parent environment is Restricted',{skip:process.platform!=='win32'},async()=>{
 const dir=await fs.mkdtemp(path.join(config.tempDir,'credential-policy-')),file=path.join(dir,'local-helper.ps1');await fs.writeFile(file,"[Console]::Out.Write('helper-ran')");
 try{
  await assert.rejects(runProcess('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Restricted','-File',file],''),e=>e.code==='POWERSHELL_SCRIPT_BLOCKED');
  const output=await runProcess('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',file],'',{env:{...process.env,PSExecutionPolicyPreference:'Restricted'}});assert.equal(output,'helper-ran');
 }finally{await fs.unlink(file);await fs.rmdir(dir);}
});
