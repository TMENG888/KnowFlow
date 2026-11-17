import test from 'node:test';import assert from 'node:assert/strict';
import {DeepSeekProvider} from '../src/creation-provider.mjs';
test('repair reports schema limits to the model, keeps locked style and aggregates retry usage',async()=>{
 const provider=new DeepSeekProvider(),calls=[],valid={prompt:'绘制从新消息排队到单会话处理的明确关系。'},style={name:'locked article style'};
 provider.chat=async(system,input)=>{calls.push({system,input});return {content:JSON.stringify(calls.length===1?{...valid,prompt:'短'}:valid),model:'deepseek-flash',usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}};};
 const r=await provider.repairIllustrationPrompt({lockedStyle:style,review:'缺少排队关系'});assert.equal(calls.length,2);assert.match(calls[1].input.revision.validationError,/15至320/);assert.deepEqual(calls[1].input.lockedStyle,style);assert.match(calls[0].system,/不规定背景颜色/);assert.equal(r.labels,undefined);assert.ok(!calls[0].system.includes('"labels"'));assert.equal(r.usage.total_tokens,300);
});
test('malformed repair stops after one corrective retry without returning invalid output',async()=>{
 const provider=new DeepSeekProvider();let calls=0;provider.chat=async()=>{calls++;return{content:'{"prompt":1,"labels":[]}',usage:{}};};await assert.rejects(provider.repairIllustrationPrompt({}),/经重试仍未通过校验/);assert.equal(calls,2);
});

test('repeated image rejection cannot accept an unchanged repair and spend another generation',async()=>{
 const provider=new DeepSeekProvider(),prompt='主系统与外部控制器之间绘制四条交叉检查箭头，循环持续复查。',calls=[];
 provider.chat=async(system,input)=>{calls.push(input);return{content:JSON.stringify({prompt:calls.length===1?prompt:'依次排列四张卡片：定时唤醒、查看状态、判断异常、按需修复。卡片用向右箭头连接；末尾写明定期重复检查。'}),usage:{}};};
 const r=await provider.repairIllustrationPrompt({prompt,reviewHistory:['方向错误','控制回路仍然错误'],lockedStyle:{name:'existing style'}});
 assert.equal(calls.length,2);assert.match(calls[1].revision.validationError,/与失败提示词相同/);assert.match(calls[1].revision.instruction,/重新设计信息组织/);assert.notEqual(r.prompt,prompt);assert.deepEqual(calls[1].lockedStyle,{name:'existing style'});
});

test('persistent unchanged repair fails before requesting another image',async()=>{
 const provider=new DeepSeekProvider(),prompt='在主系统与外部控制器间绘制多条相互交叉的循环检查箭头。';let calls=0;
 provider.chat=async()=>{calls++;return{content:JSON.stringify({prompt}),usage:{}};};
 await assert.rejects(provider.repairIllustrationPrompt({prompt,reviewHistory:['第一次错误','第二次错误']}),/与失败提示词相同/);assert.equal(calls,2);
});
