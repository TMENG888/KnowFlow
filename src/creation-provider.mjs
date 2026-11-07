import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './config.mjs';

export function runProcess(exe,args,input,{signal,timeout=180000,env=process.env}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{windowsHide:true,env,stdio:['pipe','pipe','pipe']});let out='',err='',settled=false;
  const finish=(e)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);e?reject(e):resolve(out);};
  const abort=()=>{child.kill();finish(new Error('操作已停止'));};
  const timer=setTimeout(()=>{child.kill();finish(new Error('本地模型或凭据操作超时'));},timeout);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.on('error',()=>finish(new Error('无法启动本地依赖程序，请检查运行配置')));
  child.stdout.on('data',b=>{out+=b.toString('utf8');if(out.length>40000000){child.kill();finish(new Error('本地模型输出过大'));}});
  child.stderr.on('data',b=>{err+=b.toString('utf8');if(err.length>16000)err=err.slice(-16000);});
  child.on('close',code=>finish(code===0?null:new Error('本地依赖执行失败，请检查模型路径、Python依赖或本机凭据')));
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
export class DeepSeekProvider{
 constructor({secretPath=path.join(ROOT,'private','deepseek.dpapi'),model='deepseek-flash',fetchImpl=fetch}={}){this.secretPath=secretPath;this.model=model;this.fetch=fetchImpl;}
 async secret(mode,input=''){if(process.platform!=='win32')throw new Error('此版本密钥保险箱需要 Windows DPAPI');return runProcess('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(ROOT,'scripts','secret.ps1'),'-Mode',mode,'-Path',this.secretPath],input);}
 async configured(){return fs.access(this.secretPath).then(()=>true,()=>false);}
 async configure(key){if(!/^sk-[A-Za-z0-9_-]{16,200}$/.test(key))throw new Error('密钥格式不正确');await this.secret('write',key);return this.verify();}
 async request(route,init={},signal){
  let key;try{key=await this.secret('read');}catch{throw new Error('未配置可用的本机 DeepSeek 密钥，请在创作设置中保存密钥');}
  let r;try{r=await this.fetch('https://api.deepseek.com'+route,{...init,headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000)});}catch{throw new Error(signal?.aborted?'操作已停止':'DeepSeek 请求失败或超时；已保留断点，可继续');}finally{key=null;}
  if(!r.ok){let id='';try{const error=await r.json();id=String(error.error?.message||'').match(/request_id:\s*([a-f\d-]{36})/i)?.[1]||'';}catch{}throw new Error(`DeepSeek HTTP ${r.status}：${({401:'密钥未通过验证',402:'账户余额不足',429:'请求限流，请稍后继续',500:'服务内部错误',503:'服务暂不可用'})[r.status]||'服务请求未成功'}；已保留断点${id?'；请求编号 '+id:''}`);}
  try{return await r.json();}catch{throw new Error('DeepSeek 返回格式无效；已保留断点');}
 }
 async verify(){const d=await this.request('/models');const ids=(d.data||[]).map(x=>x.id);if(!ids.includes(this.model))throw new Error('当前账户未提供 '+this.model+'，未替换为其他模型');return{configured:true,model:this.model,verified:true};}
 async chat(system,input,{json=false,signal}={}){
  const d=await this.request('/chat/completions',{method:'POST',body:JSON.stringify({model:this.model,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}],temperature:0.35,max_tokens:6000,stream:false,...(json?{response_format:{type:'json_object'}}:{})})},signal);
  const c=d.choices?.[0];if(c?.finish_reason==='length')throw new Error('DeepSeek 输出达到长度上限；未保存截断结果');if(typeof c?.message?.content!=='string'||!c.message.content.trim())throw new Error('DeepSeek 未返回正文');
  return{content:c.message.content,usage:d.usage,model:d.model||this.model};
 }
}
