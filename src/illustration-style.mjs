import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,config} from './config.mjs';
export const styleRoot=path.join(ROOT,'third_party','handraw-style');
let catalogPromise;
export const MAX_ILLUSTRATION_CONTENT_CHARS=320;
const authorStyle={styleId:'author-graphrag',name:'彩色手绘知识图解',brief:'白底、细黑手绘线，浅蓝/浅绿/浅黄分组，手写中文，少量圆头机器人',reference:'智媒锋传 GraphRAG 文章插图',source:'https://mp.weixin.qq.com/s/zjrfncJghdWihgWcMdyyKg',referenceAsset:'assets/illustrations/author-graphrag-reference.png',referenceSha256:'1088e7664eb1d0efa5b687cd127b6c572eb854c13e668eac0b8c7d59044cfab6',referenceMime:'image/png',mode:'graphic-text',provider:'doubao-ui',promptVersion:'concise-v2'};
export function configuredIllustrationStyle(settings=config){return settings.illustrationStylePreset==='author-graphrag'?structuredClone(authorStyle):null;}
export async function illustrationCatalog(){return catalogPromise||=(async()=>{const [styles,colors,manifest]=await Promise.all(['styles.json','colors.json','manifest.json'].map(async f=>JSON.parse(await fs.readFile(path.join(styleRoot,f),'utf8'))));return {styles,colors,manifest};})();}
export function positiveTraits(traits){return String(traits).split(/[；;。]/).filter(s=>!/(避免|不要|不准|禁止)/.test(s)).join('；');}
export function resolveVisualStyle(data,catalog){
 const s=catalog.styles.find(s=>s.number===data?.styleId),c=catalog.colors.find(c=>c.id===data?.colorId);if(!s||!c||!data.reason?.trim())throw new Error('插图风格或配色不在handraw-style索引中');
 const asset=catalog.manifest.assets[s.number];if(!asset)throw new Error('所选风格缺少真实参考图，未替换为其他画风');
 return {styleId:s.number,name:s.generation_name,reference:s.reference,traits:positiveTraits(s.traits),colorId:c.id,colorName:c.name_zh,colorNameEn:c.name_en,reason:data.reason,referenceAsset:asset,source:catalog.manifest.repository,commit:catalog.manifest.commit,mode:'graphic-text',provider:'doubao-ui'};
}
export function compileIllustrationPrompt(style,item){
 const theme=item.prompt.trim();
 if(!theme||theme.length>MAX_ILLUSTRATION_CONTENT_CHARS)throw new Error('内容提示词须先由模型精简至320字符以内，未截断原提示词');
 const visual=style.brief||`${style.name}；沿用样图的背景、配色、线条和字体`;
 return `16:9知识图解。画风：${visual}。参考图仅定画风，不重画其主体、文字或水印。\n${theme}`;
}
export async function referenceAsset(style,{cacheDir=path.join(config.tempDir,'illustration-style'),fetchImpl=fetch}={}){
 if(style.styleId===authorStyle.styleId){if(style.referenceAsset!==authorStyle.referenceAsset||style.referenceSha256!==authorStyle.referenceSha256)throw new Error('文章参考图记录与已确认版本不一致');const file=path.join(ROOT,authorStyle.referenceAsset),bytes=await fs.readFile(file);if(illustrationHash(bytes)!==authorStyle.referenceSha256)throw new Error('文章参考图文件发生变化，未自动替换画风');return file;}
 const c=await illustrationCatalog();if(style.commit!==c.manifest.commit||c.manifest.assets[style.styleId]!==style.referenceAsset)throw new Error('风格参考图与固定版本不一致');
 await fs.mkdir(cacheDir,{recursive:true});const file=path.join(cacheDir,style.styleId+'-'+style.commit.slice(0,10)+'.webp');try{const b=await fs.readFile(file);if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return file;}catch{}
 const r=await fetchImpl(`https://raw.githubusercontent.com/yang0/handraw-style/${style.commit}/${style.referenceAsset}`,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('画风参考图下载失败：HTTP '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length>8e6||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP')throw new Error('画风参考图不是有效WebP');await fs.writeFile(file,b);return file;
}
export const illustrationHash=s=>createHash('sha256').update(s).digest('hex');
