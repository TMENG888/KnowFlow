import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {config} from './config.mjs';
import {publicationDocument,publicationHtml,publicationChannels,digest,publicationTargetKey} from './publishing-domain.mjs';
import {tagCandidates,choosePublicationTags} from './publication-tags.mjs';

const running=new Set(['preparing','submitting']);
export class PublishingService{
 constructor(store,{creation,adapters={},covers=null,creationCovers=null,settings=config}={}){this.store=store;this.creation=creation;this.adapters=adapters;this.covers=covers;this.creationCovers=creationCovers;this.settings=settings;this.active=null;this.tagCache=new Map();
  for(const j of store.publications())if(running.has(j.status)){j.status=j.status==='submitting'?'submission_uncertain':'paused';j.message=j.status==='submission_uncertain'?'服务在提交期间中断，请人工核对抖音内容管理，系统不会重复发布':'服务已中断，发布副本已保存，点击继续';store.savePublication(j);}
 }
 catalog(){return publicationChannels;}
 get(id){const j=this.store.publication(id);if(!j)throw new Error('发布任务不存在');return j;}
 list(creationId){return this.store.publications().filter(j=>!creationId||j.creationId===creationId).map(j=>this.publicJob(j));}
 publicJob(j){if(typeof j==='string')j=this.get(j);const {document,checkpoint,...rest}=j,coverAsset=document.coverAsset?(({localFile,...cover})=>cover)(document.coverAsset):null;return {...rest,checkpoint:{submissionStartedAt:checkpoint.submissionStartedAt,importRequestedAt:checkpoint.importRequestedAt,coverReady:checkpoint.coverReady,tagsReady:checkpoint.tagsReady,draftSavedAt:checkpoint.draftSavedAt},title:document.title,author:document.author||'',coverImageId:document.coverImageId||document.images[0]?.id,coverMode:document.coverMode||'illustration',coverAsset,imageCount:document.images.length,characters:document.characters,illustrationVersion:document.illustrationVersion};}
 snapshot(id){const d=structuredClone(this.get(id).document);d.images=d.images.map(({localFile,...image})=>image);if(d.coverAsset)delete d.coverAsset.localFile;return d;}
 preview(id,input={}){if(this.creation.active===id)throw new Error('创作仍在运行，请先暂停');const job=this.creation.get(id),document=publicationDocument(job,input),cover=this.creationCovers?.matching(job,document,input.channel);if(cover&&input.coverMode==='ai')document.coverAsset=(({localFile,...asset})=>asset)(cover.document.coverAsset);return document;}
 async tags(id,input={}){const document=this.preview(id,input),job=this.creation.get(id),candidates=tagCandidates(this.store.items(job.taskId));const key=digest([document.title,document.blocks,candidates]);if(!this.tagCache.has(key)){const pending=choosePublicationTags(this.creation.provider,document,candidates).catch(e=>{this.tagCache.delete(key);throw e;});this.tagCache.set(key,pending);}return this.tagCache.get(key);}
 async create(input){if(!publicationChannels.some(p=>p.id===input.channel&&p.enabled)||!this.adapters[input.channel])throw new Error('此发布渠道尚未接入');const document=this.preview(input.creationId,input),tagSelection=await this.tags(input.creationId,input);document.tags=tagSelection.tags;document.hash=digest([document.hash,document.tags.map(t=>t.name)]);
  const channel=publicationChannels.find(c=>c.id===input.channel);if(Array.from(document.title).length>channel.titleLimit)throw new Error(channel.name+'标题最多'+channel.titleLimit+'字符');if(input.channel==='wechat'&&!document.author)throw new Error('请填写公众号作者');if(!document.images.length)throw new Error('请选择一张插画作为封面');
  const existing=this.store.publications().find(j=>j.channel===input.channel&&(j.requestHash||j.document.hash)===document.hash);if(existing)return this.publicJob(existing);
  const j={id:randomUUID(),requestHash:document.hash,creationId:input.creationId,channel:input.channel,document,tagSelection,status:'queued',createdAt:new Date().toISOString(),message:'已固定正文、插图和推荐标签，等待准备',checkpoint:{},events:[]};
  if(input.reuseDraftFromId){const prior=this.get(input.reuseDraftFromId),bodyKey=d=>digest([d.title,d.author,d.blocks,d.images.map(i=>i.id)]);if(prior.channel!==j.channel||prior.checkpoint.submissionStartedAt||prior.status!=='ready'||bodyKey(prior.document)!==bodyKey(document)||!prior.checkpoint.preparedUrl)throw new Error('原草稿不能复用：正文、图片、作者或发布状态不一致');j.checkpoint={...structuredClone(prior.checkpoint),coverReady:false};j.reusedDraftFromId=prior.id;}
  this.save(j,'created',j.message);return this.publicJob(j);
 }
 save(j,stage,message){j.updatedAt=new Date().toISOString();if(message)j.message=message;if(stage){j.events.push({at:j.updatedAt,stage,message});if(j.events.length>200)j.events=j.events.slice(-200);}this.store.savePublication(j);}
 async draftCopy(id){if(this.active)throw new Error('请等待当前草稿步骤完成');const original=this.get(id),j={id:randomUUID(),requestHash:original.requestHash,creationId:original.creationId,channel:original.channel,document:structuredClone(original.document),tagSelection:structuredClone(original.tagSelection),coverPlan:structuredClone(original.coverPlan),copiedFromId:id,status:'queued',createdAt:new Date().toISOString(),checkpoint:{},events:[],message:'已另存审核副本，仅保存草稿'};const dir=this.directory(j);await fs.mkdir(dir,{recursive:true});
  if(j.document.coverAsset){const {bytes}=await this.cover(id);const localFile=path.join(dir,'cover-ai.jpg');await fs.writeFile(localFile,bytes);j.document.coverAsset={...j.document.coverAsset,localFile,url:`/api/publications/${j.id}/cover`};}
  this.save(j,'review_copy',j.message);return this.publicJob(j);
 }
 directory(j){return path.join(this.settings.outputDir,'publications',j.id);}
 async materialize(j){const dir=this.directory(j);await fs.mkdir(dir,{recursive:true});for(const image of j.document.images){const file=path.join(dir,image.id+'.'+(image.mime==='image/jpeg'?'jpg':image.mime==='image/webp'?'webp':'png'));let bytes;try{bytes=await fs.readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;bytes=(await this.creation.illustrations.image(this.creation.get(j.creationId),image.id)).bytes;await fs.writeFile(file,bytes);}if(image.sha256&&image.sha256!==digest(bytes))throw new Error('发布副本图片校验失败，未上传');image.sha256=digest(bytes);image.localFile=file;}
  await fs.writeFile(path.join(dir,'article.html'),publicationHtml(j.document,i=>path.basename(i.localFile)));await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(j.document,null,2));this.save(j);return dir;
 }
 start(id,{publish=false}={}){if(typeof publish!=='boolean')throw new Error('publish必须是布尔值');if(publish)throw new Error('自动流程仅保存草稿，请在平台人工审核后发布');const j=this.get(id);if(this.active)throw new Error('已有发布步骤运行中');if(['published','submission_uncertain'].includes(j.status))throw new Error(j.status==='published'?'这份文章已发布，未重复提交':'此前提交结果不确定，请先在平台核对，系统不会自动重发');if(j.checkpoint.submissionStartedAt)throw new Error('已进入发布提交阶段，禁止重复提交');const target=publicationTargetKey(j.channel,j.checkpoint.preparedUrl);if(target&&this.store.publications().some(other=>other.id!==j.id&&other.checkpoint.submissionStartedAt&&publicationTargetKey(other.channel,other.checkpoint.preparedUrl)===target))throw new Error('同一平台草稿已有提交记录，禁止通过其他封面副本重复发布');this.active=id;this.controller=new AbortController();j.status='preparing';this.save(j,'preparing','正在检查所选平台登录状态与文章副本');
  this.work(j,{publish,signal:this.controller.signal}).catch(e=>{j.status=j.checkpoint.submissionStartedAt?'submission_uncertain':e.code==='PUBLISH_LOGIN'?'waiting_login':e.code==='PUBLISH_VERIFICATION'?'waiting_verification':e.code==='PUBLISH_MANUAL'?'needs_review':this.controller.signal.aborted?'paused':'failed';this.save(j,'interrupted',e.message);}).finally(()=>{this.active=null;this.controller=null;});return this.publicJob(j);
 }
 async cover(id){const j=this.get(id),asset=j.document.coverAsset;if(!asset||asset.channel!==j.channel||asset.filename!=='cover-ai.jpg')throw new Error('专用封面尚未生成');const bytes=await fs.readFile(path.join(this.directory(j),asset.filename));if(digest(bytes)!==asset.sha256)throw new Error('专用封面文件校验失败');return {bytes,mime:asset.mime};}
 async work(j,{publish,signal}){const dir=await this.materialize(j),adapter=this.adapters[j.channel],save=()=>this.save(j),progress=(stage,message)=>this.save(j,stage,message),ctx={dir,signal,save,progress};if(j.document.coverMode==='ai'){if(!this.covers)throw new Error('AI封面模块尚未加载');if(!await this.creationCovers?.reuse(j,ctx))await this.covers.ensure(j,ctx);await this.materialize(j);}await adapter.prepare(j,ctx);signal.throwIfAborted();j.status='ready';this.save(j,'ready','正文、插图与封面已填入并核对，可以发布');if(!publish)return;
  // Persist before the external click. A crash or timeout must never cause a resend.
  const receipt=await adapter.publish(j,{...ctx,beforeSubmit:()=>{signal.throwIfAborted();j.status='submitting';j.checkpoint.submissionStartedAt=new Date().toISOString();this.save(j,'submitting','正在提交，结果未确认前不会重复发布');}});
  if(receipt?.requiresConfirmation&&!j.checkpoint.submissionStartedAt){j.status='awaiting_confirmation';this.save(j,'awaiting_confirmation',receipt.message||'完整草稿已就绪，请在平台完成最终发表');return;}
  if(!receipt?.confirmed)throw new Error('无法确认平台是否收到了发布请求，请人工核对');j.status='published';j.receipt=receipt;this.save(j,'published',receipt.message||'平台已确认提交，等待审核');
 }
 stop(id){const j=this.get(id);if(this.active===id)this.controller.abort();return this.publicJob(j);}
}
