import fs from 'node:fs/promises';
import path from 'node:path';
import {digest} from './publishing-domain.mjs';
import {imageDimensions} from './doubao-browser.mjs';
// Only the fixed publication copy may supply a cover for upload.
export async function publicationCoverFile(job,dir){
 if(job.document.coverMode!=='ai')return path.join(dir,'cover.jpg');
 const asset=job.document.coverAsset,expected=job.channel==='wechat'?{width:900,height:383}:job.channel==='douyin'?{width:1080,height:1440}:null;
 if(!expected||!asset||asset.channel!==job.channel||asset.filename!=='cover-ai.jpg'||path.resolve(asset.localFile||'')!==path.resolve(dir,'cover-ai.jpg')||asset.sourceHash!==digest([job.channel,job.document.title,job.document.blocks]))throw new Error('平台专用封面与固定稿件不一致，未上传');
 const bytes=await fs.readFile(asset.localFile),size=imageDimensions(bytes);
 if(digest(bytes)!==asset.sha256||size.width!==expected.width||size.height!==expected.height)throw new Error('平台专用封面校验失败，未上传');
 return asset.localFile;
}
