import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {config,ROOT} from './config.mjs';
import {runProcess} from './creation-provider.mjs';
import {digest,publicationDocument} from './publishing-domain.mjs';
import {COVER_POLICIES,COVER_DESIGN_VERSION} from './publication-cover.mjs';
import {publicationCoverFile} from './publication-cover-file.mjs';
import {currentIllustrationBody} from '../public/illustration-document.mjs';
import {currentTitleWorkflow} from './title-domain.mjs';

export function assertCoverReady(job){
 if(!job.draft?.trim()||!job.sections?.length||job.sections.some(s=>!s.draft?.trim()||s.draftStale||s.retrievalStale))throw new Error('请先完成并确认全部章节正文，再生成平台封面');
 for(const s of job.sections){const p=s.illustrationPlan;if(!p||p.sourceText!==currentIllustrationBody(job,s)||!Array.isArray(p.items)||p.needed!==false&&!p.items.length||p.items.some(i=>i.status!=='completed'||i.imageValidation?.passed===false))throw new Error('请先完成第 '+s.id+' 章插图，再生成平台封面');}
 if(!job.sections.some(s=>s.illustrationPlan.items.length))throw new Error('需要至少一张已完成的正文插图以完成图文创作');
}
export const coverSourceHash=job=>digest([COVER_DESIGN_VERSION,job.coverAudience||'',job.coverDirection||'',job.draft,currentTitleWorkflow(job)?.titles||null,job.visualStyle,job.visualAnchor,job.sections?.map(s=>[s.id,s.draft,s.draftStale,s.retrievalStale,s.illustrationPlan?.sourceHash,s.illustrationPlan?.items?.map(i=>[i.id,i.filename,i.status])])]);
export class CreationCoversService{
 constructor({store,research,generator,illustrations,settings=config}={}){Object.assign(this,{store,research,generator,illustrations,settings});}
 ready(job){try{assertCoverReady(job);return true;}catch{return false;}}
 directory(job,channel){return path.join(this.settings.outputDir,'creations',job.id,'covers',channel);}
 async context(record,ctx){
  const job=this.store.creation(record.creationId);if(!job)throw new Error('封面所属创作不存在');assertCoverReady(job);
  const research=await this.research.analyze(job,record.channel,record,{...ctx,progress:message=>ctx.progress?.('cover_research',message)});
  if(!record.coverPlan||record.coverPlan.referenceRole==='cover-design-only')return {research,topicContext:{audience:job.coverAudience||job.instructions||'',designBrief:job.coverDirection||'',keyword:job.keyword,referenceTitle:job.reference.title,referenceExcerpt:job.reference.text.slice(0,1600)}};
  const anchor=await this.illustrations.anchor(job);if(!anchor)throw new Error('未找到全文插画风格锚');
  return {research,topicContext:{audience:job.coverAudience||job.instructions||'',designBrief:job.coverDirection||'',keyword:job.keyword,referenceTitle:job.reference.title,referenceExcerpt:job.reference.text.slice(0,1600)},style:job.visualStyle,styleFile:anchor.path,styleSha256:anchor.sha256};
 }
 async run(job,{signal,save=()=>{}}={}){
  assertCoverReady(job);const signature=coverSourceHash(job),previous=job.coverWorkflow;
  if(job.coverWorkflow&&job.coverWorkflow.sourceHash!==signature){(job.coverHistory||=[]).push(job.coverWorkflow);job.coverHistory=job.coverHistory.slice(-2);job.coverWorkflow=null;}
  job.coverWorkflow||={version:COVER_DESIGN_VERSION,sourceHash:signature,status:'running',channels:{},createdAt:new Date().toISOString()};
  const flow=job.coverWorkflow;flow.status='running';delete flow.error;save();
  try{for(const channel of job.coverChannels||['wechat','douyin']){
   signal?.throwIfAborted();if(!COVER_POLICIES[channel])throw new Error('尚未接入该平台封面尺寸');
   let record=flow.channels[channel];if(record?.coverPlan?.status==='completed'){await publicationCoverFile(record,this.directory(job,channel));continue;}
   record||=(flow.channels[channel]={id:randomUUID(),creationId:job.id,channel,document:publicationDocument(job,{channel,coverMode:'ai'}),checkpoint:{}});
   if(!record.coverResearch&&previous?.channels?.[channel]?.coverResearch?.status==='completed'&&previous.channels[channel].coverResearch.taskId===job.taskId)record.coverResearch=structuredClone(previous.channels[channel].coverResearch);
   const dir=this.directory(job,channel);await fs.mkdir(dir,{recursive:true});flow.activeChannel=channel;
   await this.generator.ensure(record,{dir,signal,save,imageURL:`/api/creations/${job.id}/covers/${channel}/image`,progress:(stage,message)=>{job.progress=message;flow.stage=stage;save();}});
  }flow.status='completed';flow.completedAt=new Date().toISOString();delete flow.activeChannel;job.progress='全文图文与各平台封面已完成，等待人工审核';save();
  }catch(e){flow.status=signal?.aborted?'paused':e.code==='COVER_REFERENCES_MISSING'?'waiting_references':e.code==='DOUBAO_QUOTA_EXHAUSTED'?'waiting_quota':'failed';flow.error=e.message;save();throw e;}
 }
 publicWorkflow(job){const flow=job.coverWorkflow;if(!flow)return null;const stale=flow.sourceHash!==coverSourceHash(job);return {...flow,status:stale?'stale':flow.status,channels:Object.fromEntries(Object.entries(flow.channels).map(([channel,r])=>[channel,{channel,coverPlan:r.coverPlan?(({checkpoint,...p})=>p)(r.coverPlan):null,coverResearch:r.coverResearch,coverAsset:!stale&&r.document.coverAsset?(({localFile,...a})=>a)(r.document.coverAsset):null}]))};}
 async reframe(job,channel,{centerY}={}){
  if(typeof centerY!=='number'||!Number.isFinite(centerY)||centerY<0||centerY>1)throw new Error('封面取景位置须为0—1');
  await this.image(job,channel);const r=job.coverWorkflow.channels[channel],p=r.coverPlan,dir=this.directory(job,channel),filename=p.downloaded?.filename;
  if(!filename||path.basename(filename)!==filename)throw new Error('封面原图断点无效');
  const raw=path.join(dir,filename),file=r.document.coverAsset.localFile,source=await fs.readFile(raw);
  await runProcess(this.settings.publicationPython||this.settings.pythonExecutable,[path.join(ROOT,'src','publication_cover.py'),raw,file,String(p.policy.width),String(p.policy.height),'fill:'+centerY],'');
  const sha=digest(await fs.readFile(file));p.crop={centerX:.5,centerY,sourceSha256:digest(source),resultSha256:sha,at:new Date().toISOString()};r.document.coverAsset.sha256=sha;r.document.hash=digest([r.requestHash||r.document.hash,sha]);this.store.saveCreation(job);return this.publicWorkflow(job);
 }
 async image(job,channel){if(job.coverWorkflow?.sourceHash!==coverSourceHash(job))throw new Error('正文、插图或风格已变更，请重新生成封面');const r=job.coverWorkflow?.channels[channel];if(r?.coverPlan?.status!=='completed')throw new Error('平台封面尚未完成');const file=await publicationCoverFile(r,this.directory(job,channel));return {bytes:await fs.readFile(file),mime:'image/jpeg'};}
 async reference(job,channel,id){const ref=job.coverWorkflow?.channels[channel]?.coverResearch?.references.find(r=>r.referenceId===id);if(!ref)throw new Error('参考封面不存在');const root=path.resolve(this.directory(job,channel),'references'),file=path.resolve(this.settings.outputDir,ref.file);if(!file.startsWith(root+path.sep))throw new Error('参考封面路径异常');const bytes=await fs.readFile(file);if(digest(bytes)!==ref.sha256)throw new Error('参考封面校验失败');return {bytes,mime:'image/jpeg'};}
 matching(job,document,channel){const r=job.coverWorkflow?.channels[channel];return job.coverWorkflow?.sourceHash===coverSourceHash(job)&&r?.coverPlan?.status==='completed'&&r.document.coverAsset?.sourceHash===digest([channel,document.title,document.blocks])?r:null;}
 async reuse(publication,{dir,save=()=>{}}){const job=this.store.creation(publication.creationId),r=job&&this.matching(job,publication.document,publication.channel);if(!r)return false;const {bytes}=await this.image(job,publication.channel);await fs.mkdir(dir,{recursive:true});const localFile=path.join(dir,'cover-ai.jpg');await fs.writeFile(localFile,bytes);publication.coverResearch=structuredClone(r.coverResearch);publication.coverPlan=structuredClone(r.coverPlan);publication.document.coverAsset={...r.document.coverAsset,localFile,url:`/api/publications/${publication.id}/cover`};publication.document.hash=digest([publication.requestHash||publication.document.hash,digest(bytes)]);publication.coverReusedFromCreation=job.id;save();return true;}
}
