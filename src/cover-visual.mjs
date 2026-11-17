export const VISUAL_RESEARCH_VERSION='visual-scene-methods-v5';
export const COVER_REFERENCE_HYGIENE_VERSION='reference-text-clean-v1';
export const COVER_REFERENCE_HYGIENE_RULES='参考图清理约束：生成新封面时不继承样本的作者署名、账号名、头像水印、归属标记、系列名、页码，以及收藏、关注、点赞、转发、扫码、购买等引导话术或广告角标。保留本篇明确指定的主标题、主题品牌和必要知识标签，不把主题名称误当水印删除；删除后自然衔接背景，不保留空白占位，也不换成新的署名或引导话术。';
export function cleanCoverReferencePrompt(prompt){return prompt.includes(COVER_REFERENCE_HYGIENE_RULES)?prompt:prompt+'\n'+COVER_REFERENCE_HYGIENE_RULES;}

const ids=['S1','S2','S3','S4','S5'];
const numeric=['textAreaPct','headlineWidthPct','fontSizePctWidth','subjectAreaPct','whitespacePct','textLines'];
const enums={fontWeight:['regular','bold','heavy'],contrast:['low','medium','high'],layout:['top','left','center','split'],readability:['weak','moderate','strong']};
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
export function validateVisualResearch(d){
 if(!only(d,['observations','rules','creativeMethods','sceneTreatments','limitations'])||!Array.isArray(d.observations)||d.observations.length!==5||new Set(d.observations.map(o=>o.referenceId)).size!==5)throw new Error('视觉分析须恰好覆盖S1—S5，仅含observations、rules、creativeMethods和limitations');
 for(const o of d.observations){if(!only(o,['referenceId',...numeric,...Object.keys(enums)])||!ids.includes(o.referenceId)||numeric.some(k=>typeof o[k]!=='number'||!Number.isFinite(o[k])||o[k]<0||o[k]>100)||Object.entries(enums).some(([k,values])=>!values.includes(o[k])))throw new Error('逐图观察只允许画面比例、字重、对比、布局与可读性，不提取文案标签或题材元素');}
 if(!Array.isArray(d.rules)||d.rules.length>10||new Set(d.rules.map(r=>r.id)).size!==d.rules.length)throw new Error('视觉约束规则编号重复或格式无效');
 for(const r of d.rules){if(!only(r,['id','property','min','max','value','referenceIds'])||!/^V\d+$/.test(r.id)||!Array.isArray(r.referenceIds)||new Set(r.referenceIds).size<2||new Set(r.referenceIds).size!==r.referenceIds.length||r.referenceIds.some(id=>!ids.includes(id)))throw new Error('每条画面规则必须由至少2张实际样本支持');if(numeric.includes(r.property)){if(typeof r.min!=='number'||typeof r.max!=='number'||!Number.isFinite(r.min)||!Number.isFinite(r.max)||r.min<0||r.max>100||r.min>r.max||Object.hasOwn(r,'value'))throw new Error('画面比例约束须为0—100的估算区间');}else if(!['fontWeight','contrast','layout'].includes(r.property)||!enums[r.property].includes(r.value)||Object.hasOwn(r,'min')||Object.hasOwn(r,'max'))throw new Error('画面规则只允许比例区间和视觉枚举值，不接收内容或元素名称');}
 if(!Array.isArray(d.creativeMethods)||d.creativeMethods.length<1||d.creativeMethods.length>6||new Set(d.creativeMethods.map(m=>m.id)).size!==d.creativeMethods.length)throw new Error('creativeMethods须包含1—6条可迁移的视觉创意方法，编号不得重复');
 for(const m of d.creativeMethods){if(!only(m,['id','type','principle','execution','thumbnailEffect','referenceIds'])||!/^M\d+$/.test(m.id)||!['hierarchy','scale','typography_integration','contrast','visual_metaphor','cropping','negative_space','compression'].includes(m.type)||['principle','execution','thumbnailEffect'].some(k=>typeof m[k]!=='string'||!m[k].trim()||m[k].length>180)||!Array.isArray(m.referenceIds)||!m.referenceIds.length||new Set(m.referenceIds).size!==m.referenceIds.length||m.referenceIds.some(id=>!ids.includes(id)))throw new Error('视觉创意方法须描述抽象画面操作及缩略图作用，并关联实际S编号；不包含样本文案或主题元素字段');}
 if(!Array.isArray(d.sceneTreatments)||d.sceneTreatments.length!==5||new Set(d.sceneTreatments.map(t=>t.referenceId)).size!==5)throw new Error('sceneTreatments须逐一覆盖5张样本的背景、主体表现、空间及互动');
 for(const t of d.sceneTreatments)if(!only(t,['referenceId','background','subjectForm','depth','interaction'])||!ids.includes(t.referenceId)||['background','subjectForm','depth','interaction'].some(k=>typeof t[k]!=='string'||!t[k].trim()||t[k].length>140))throw new Error('场景观察须描述抽象的材质、空间和互动，不能添加品牌或题材字段');
 if(typeof d.limitations!=='string'||d.limitations.length>1600)throw new Error('视觉分析须说明估算和样本限制');return d;
}
// An allowlisted boundary: sample copy, labels, topics, objects and free-form notes
// never become inputs to the cover writer, including for legacy saved research.
export function visualReference(research){
 if(![VISUAL_RESEARCH_VERSION,VISUAL_RESEARCH_VERSION+'-aspect-v1'].includes(research?.version)||research.status!=='completed')throw new Error('请先完成新版仅画面约束分析，旧版分析未保留创意方法，须重新研究');
 const d=validateVisualResearch(research.analysis);
 return {version:VISUAL_RESEARCH_VERSION,estimated:true,sceneTreatments:d.sceneTreatments.map(t=>({referenceId:t.referenceId,background:t.background,subjectForm:t.subjectForm,depth:t.depth,interaction:t.interaction})),creativeMethods:d.creativeMethods.map(m=>({id:m.id,type:m.type,principle:m.principle,execution:m.execution,thumbnailEffect:m.thumbnailEffect,referenceIds:[...m.referenceIds]})),rules:d.rules.map(r=>({id:r.id,property:r.property,...(numeric.includes(r.property)?{min:r.min,max:r.max}:{value:r.value}),referenceIds:[...r.referenceIds]}))};
}
const norm=v=>String(v??'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
export function validateVisualLayout(layout,{headline,visual,policy,integrated=false}={}){
 const problems=[],box=(b,name)=>{if(!b||['x','y','width','height'].some(k=>typeof b[k]!=='number'||!Number.isFinite(b[k]))||b.x<5||b.y<5||b.width<=0||b.height<=0||b.x+b.width>95||b.y+b.height>95)problems.push(name+'须在最终画幅5%—95%安全区内，以0—100比例描述x/y/width/height');};
 if(!layout||typeof layout!=='object')throw new Error('visualLayout缺少可执行的封面画面约束');
 box(layout.headlineBox,'headlineBox');box(layout.subjectBox,'subjectBox');
 if(!Array.isArray(layout.headlineLines)||layout.headlineLines.length<1||layout.headlineLines.length>3||layout.headlineLines.some(t=>typeof t!=='string'||!t.trim())||norm(layout.headlineLines.join(''))!==norm(headline))problems.push('headlineLines须将headline原文分为1—3行，不能增删文字');
 if(typeof layout.fontSizePctWidth!=='number'||!Number.isFinite(layout.fontSizePctWidth)||layout.fontSizePctWidth<6||layout.fontSizePctWidth>18)problems.push('主字字高须为画幅宽度6%—18%，避免正文插图式小标题');
 if(!['bold','heavy'].includes(layout.fontWeight))problems.push('主标题须选bold或heavy粗字重，成为封面视觉第一层');
 if(layout.contrast!=='high')problems.push('主标题与背景须采用high强对比');
 if(typeof layout.whitespacePct!=='number'||!Number.isFinite(layout.whitespacePct)||layout.whitespacePct<0||layout.whitespacePct>45)problems.push('整体留白控制在0%—45%，不沿用正文插画的大面积空白');
 if(layout.headlineBox?.width*layout.headlineBox?.height<2200)problems.push('主文字区域至少占最终画幅面积22%，将封面标题设为第一视觉层');
 if(!Array.isArray(layout.appliedRuleIds)||new Set(layout.appliedRuleIds).size!==layout.appliedRuleIds.length||layout.appliedRuleIds.some(id=>!visual.rules.some(r=>r.id===id))||visual.rules.length&&!layout.appliedRuleIds.length)problems.push('appliedRuleIds须关联实际画面规则，不得虚构编号');
 if(typeof layout.reason!=='string'||!layout.reason.trim()||layout.reason.length>500)problems.push('visualLayout.reason须说明参考规则如何适配平台画幅和本篇文案');
 if(policy&&Array.isArray(layout.headlineLines)&&typeof layout.fontSizePctWidth==='number'){
  const maxWidth=Math.max(...layout.headlineLines.map(line=>Array.from(line).reduce((n,c)=>n+(/[\x00-\x7F]/.test(c)?.55:1),0)))*layout.fontSizePctWidth;
  if(!integrated&&maxWidth<(layout.headlineBox?.width||0)*.7)problems.push('主标题实际字宽不足文字框70%，区域大但字仍小；按当前分行，fontSizePctWidth至少'+((layout.headlineBox?.width||0)*.7/maxWidth*layout.fontSizePctWidth).toFixed(1)+'，或将headlineBox.width收紧至'+(maxWidth/.7).toFixed(1)+'以内，同时保持文字框面积至少22%；标题可与主体边缘穿插但不可遮挡字义');
  if(maxWidth>(layout.headlineBox?.width||0)+3)problems.push('按所选字号估算，最长标题行超过文字区宽度；当前分行与文字框下，fontSizePctWidth最多'+((layout.headlineBox?.width||0)/maxWidth*layout.fontSizePctWidth).toFixed(1)+'；请缩短文案、重新分行或扩大文字框');
  const neededHeight=layout.headlineLines.length*layout.fontSizePctWidth*policy.width/policy.height;
  if(!integrated&&neededHeight<(layout.headlineBox?.height||0)*.6)problems.push('主标题实际字高不足文字框60%；按当前行数及区域，fontSizePctWidth至少'+((layout.headlineBox?.height||0)*.6/layout.headlineLines.length*policy.height/policy.width).toFixed(1)+'，或将headlineBox.height收紧至'+(neededHeight/.6).toFixed(1)+'以内，同时保持文字框面积至少22%，避免虚报大标题区域');
  if(neededHeight>(layout.headlineBox?.height||0)+3)problems.push('所选字高与行数超过文字区高度；当前行数与文字框下，fontSizePctWidth最多'+((layout.headlineBox?.height||0)/layout.headlineLines.length*policy.height/policy.width).toFixed(1)+'；也可增加文字框高度，样本字号不能原样套用到较矮的横幅');
 }
 if(problems.length)throw new Error(problems.join('；'));return layout;
}
export function compileVisualPrompt(plan,policy){
 const l=plan.visualLayout,b=l.headlineBox,s=l.subjectBox;
 return cleanCoverReferencePrompt(`${policy.generationRatio}封面，最终${policy.width}×${policy.height}。${policy.generationRatio==='16:9'?'先在原图正中央设计2.35:1横版裁切框，上下仅延展背景。':''}上传参考图仅用于封面字体处理、配色、画面张力和文字图形组合，不复刻其中的文案、品牌、角色或题材。画风独立于正文插图；以本次设计方案为准，不能退回普通手绘图解排版。${plan.creativeConcept?.styleDirection?'视觉方向：'+plan.creativeConcept.styleDirection+'。':''}\n以下比例相对最终画幅：主文字区左${b.x}%/上${b.y}%/宽${b.width}%/高${b.height}%；主字字高约画宽${l.fontSizePctWidth}%，${l.fontWeight==='heavy'?'特粗':'粗体'}展示字，文字与底色强对比，分${l.headlineLines.length}行：${l.headlineLines.map(t=>'“'+t+'”').join(' / ')}。图形区左${s.x}%/上${s.y}%/宽${s.width}%/高${s.height}%，整体留白约${l.whitespacePct}%。\n${plan.sceneDesign?'背景场景：'+plan.sceneDesign.backgroundPrompt+'\n主体表现：'+plan.sceneDesign.subjectTreatment+'\n':''}${plan.prompt}\n图内只写上述主标题${plan.tags.length?'，另以小字补充'+plan.tags.map(t=>'“'+t+'”').join('、'):''}，无其他文字或水印。`);
}
