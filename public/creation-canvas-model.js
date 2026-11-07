(()=>{
 const running=j=>['segmenting','indexing','retrieving','writing'].includes(j.status);
 function activeSection(j){if(!running(j))return null;if(j.activeStep?.sectionId)return j.activeStep.sectionId;if(j.status==='writing')return j.sections?.find(s=>!s.draft)?.id;return null;}
 function sectionState(j,s){if(activeSection(j)===s.id)return j.status==='writing'?'正在撰写':'正在召回';if(s.retrievalStale)return'问题已修改';if(s.draftStale)return'草稿待更新';if(s.draft)return'草稿已生成';if(s.evidence)return'素材待审核';return'等待召回';}
 function graph(j,expanded=new Set()){
  const nodes=[],edges=[],sections=j.sections||[],rx=700;
  nodes.push({id:'root',kind:'root',x:rx,y:90,title:j.outline?.title||j.reference.title,label:'全文写作思路',subtitle:j.outline?.creationApproach||'点击分析参考文章与全文组织方案',state:running(j)?'正在处理':j.outline?.creationApproach?'已提炼':'待分析'});
  let top=210,previous='root';
  for(const s of sections){
   const open=expanded.has(s.id),block=open?Math.max(300,(s.evidence?.length||1)*122,(s.referenceEvidence?.length||0)*244+40):300,cy=top+block/2,id='s:'+s.id;
   nodes.push({id,kind:'section',sectionId:s.id,x:rx,y:cy-70,title:s.heading,label:'章节 '+s.id,subtitle:s.intent,state:sectionState(j,s),expanded:open,active:activeSection(j)===s.id});
   edges.push({from:previous,to:id,type:'flow'});
   nodes.push({id:'g:'+s.id,kind:'guidance',sectionId:s.id,x:340,y:cy-70,label:'本章写作指导',title:s.heading,subtitle:s.requirements||s.intent||'尚未提炼，请分析全文思路',state:s.requirements?'已提炼':'待补充'});
   edges.push({from:id,to:'g:'+s.id});
   nodes.push({id:'d:'+s.id,kind:'draft',sectionId:s.id,x:rx,y:cy+70,label:'章节草稿',title:s.draft?'查看本章草稿':'本章尚未生成',subtitle:s.draftStale?'审核已变化，建议重写':`${currentSectionDraft(j,s).length} 字符`,state:sectionState(j,s),active:activeSection(j)===s.id&&j.status==='writing'});
   edges.push({from:id,to:'d:'+s.id,type:'flow'});previous='d:'+s.id;
   if(open){
    const query='q:'+s.id;nodes.push({id:query,kind:'query',sectionId:s.id,x:1060,y:cy-70,title:s.query,label:'语义检索问题',subtitle:s.retrievalStale?'已修改，需重新召回':`${s.evidence?.length||0} 个分块 · ${s.evidence?.reduce((n,e)=>n+e.text.length,0)||0} 字符`,state:s.retrievalStale?'待重新召回':s.evidence?'已召回':'等待召回',active:activeSection(j)===s.id&&j.status==='retrieving'});edges.push({from:id,to:query});
    for(const [kind,list,x] of [['reference',s.referenceEvidence||[],340],['evidence',s.evidence||[],1420]])list.forEach((e,n)=>{
     const lid='e:'+s.id+':'+e.citation;nodes.push({id:lid,kind,sectionId:s.id,citation:e.citation,x,y:kind==='reference'?cy+70+n*122:cy+(n-(list.length-1)/2)*122,label:(kind==='reference'?'参考原文 · ':'召回分块 · ')+e.citation,title:e.title,subtitle:e.text.slice(0,65),state:e.review==='exclude'?'已排除':e.review==='keep'?'已保留':'待审核',decision:e.review||'pending',cited:new RegExp('\\['+e.citation+'\\]').test(j.draft||'')});edges.push({from:kind==='reference'?'g:'+s.id:query,to:lid,excluded:e.review==='exclude'});
    });
   }
   top+=block+80;
  }
  if(sections.length){nodes.push({id:'result',kind:'result',x:rx,y:top+30,label:'全文结果',title:j.outline?.title||'文章草稿',subtitle:j.draft?`已保存 ${j.draft.length} 字符，点击预览全文`:'等待各章撰写完成',state:j.draft?'可预览':'待生成'});edges.push({from:previous,to:'result',type:'flow'});}
  else {nodes.push({id:'waiting',kind:'waiting',x:rx,y:300,title:j.status==='segmenting'?'正在拆解参考文章':'等待章节框架',label:'语义拆解',subtitle:'真实章节返回后，会在这里逐步展开。',state:j.status==='failed'?'需要处理':'等待',active:j.status==='segmenting'});edges.push({from:'root',to:'waiting',type:'flow'});}
  return {nodes,edges,width:1620,height:Math.max(520,top+150)};
 }
 function currentSectionDraft(j,s){const marker='## '+s.heading+'\n',at=j.draft?.indexOf(marker);if(at>=0){const tail=j.draft.slice(at+marker.length),m=/\n## [^\n]+\n/.exec(tail);return(m?tail.slice(0,m.index):tail).trim();}return s.draft||'';}
 globalThis.KnowFlowCanvasModel={graph,activeSection,sectionState,running,currentSectionDraft};
})();
