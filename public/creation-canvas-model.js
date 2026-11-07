(()=>{
 const running=j=>['segmenting','indexing','retrieving','writing'].includes(j.status);
 function activeSection(j){if(!running(j))return null;if(j.activeStep?.sectionId)return j.activeStep.sectionId;if(j.status==='writing')return j.sections?.find(s=>!s.draft)?.id;return null;}
 function sectionState(j,s){if(activeSection(j)===s.id)return j.status==='writing'?'正在撰写':'正在召回';if(s.retrievalStale)return'问题已修改';if(s.draftStale)return'草稿待更新';if(s.draft)return'草稿已生成';if(s.evidence)return'素材待审核';return'等待召回';}
 function graph(j,expanded=new Set()){
  const nodes=[],edges=[],sections=j.sections||[],sides=[sections.filter((_,i)=>i%2===0),sections.filter((_,i)=>i%2===1)];
  const heights=sides.map(side=>side.reduce((n,s)=>n+(expanded.has(s.id)?Math.max(300,((s.evidence?.length||0)+(s.referenceEvidence?.length||0)+1)*118):148)+44,0));
  const height=Math.max(520,...heights)+140,rx=1260,ry=height/2;
  nodes.push({id:'root',kind:'root',x:rx,y:ry,title:j.outline?.title||j.reference.title,label:'参考文章',subtitle:j.reference.title,state:running(j)?j.status==='writing'?'撰写进行中':j.status==='segmenting'?'正在拆解章节':'正在准备素材':j.draft?'文章已生成':'等待处理'});
  sides.forEach((side,index)=>{const sign=index===0?1:-1;let y=(height-heights[index])/2;for(const s of side){const open=expanded.has(s.id),leafs=[...(s.referenceEvidence||[]).map(e=>({kind:'reference',e})),...(s.evidence||[]).map(e=>({kind:'evidence',e})),{kind:'draft'}],block=open?Math.max(300,leafs.length*118):148,cy=y+block/2;
   const id='s:'+s.id;nodes.push({id,kind:'section',sectionId:s.id,x:rx+sign*340,y:cy,title:s.heading,label:'章节 '+s.id,subtitle:s.intent,state:sectionState(j,s),expanded:open,active:activeSection(j)===s.id,stale:s.draftStale||s.retrievalStale});edges.push({from:'root',to:id});
   if(open){const query='q:'+s.id;nodes.push({id:query,kind:'query',sectionId:s.id,x:rx+sign*660,y:cy,title:s.query,label:'检索问题',subtitle:s.retrievalStale?'已修改，需重新召回':`${s.evidence?.length||0} 个分块 · ${s.evidence?.reduce((n,e)=>n+e.text.length,0)||0} 字符`,state:s.retrievalStale?'待重新召回':s.evidence?'已召回':'等待召回',active:activeSection(j)===s.id&&j.status==='retrieving'});edges.push({from:id,to:query});
    leafs.forEach(({kind,e},n)=>{const lid=kind==='draft'?'d:'+s.id:'e:'+s.id+':'+e.citation,cited=e&&new RegExp('\\['+e.citation+'\\]').test(j.draft||'');nodes.push({id:lid,kind,sectionId:s.id,citation:e?.citation,x:rx+sign*1000,y:y+59+n*118,label:kind==='draft'?'章节草稿':kind==='reference'?'参考原文 · '+e.citation:'召回分块 · '+e.citation,title:kind==='draft'?(s.draft?'查看本章草稿':'本章尚未生成'):e.title,subtitle:kind==='draft'?(s.draftStale?'审核已变化，建议重写':`${s.draft?.length||0} 字符`):e.text.slice(0,65),state:kind==='draft'?sectionState(j,s):e.review==='exclude'?'已排除':e.review==='keep'?'已保留':'待审核',decision:e?.review||'pending',cited,active:kind==='draft'&&activeSection(j)===s.id&&j.status==='writing'});edges.push({from:kind==='evidence'?query:id,to:lid,excluded:e?.review==='exclude'});});
   }y+=block+44;
  }});
  if(!sections.length)nodes.push({id:'waiting',kind:'waiting',x:rx+350,y:ry,title:j.status==='segmenting'?'正在拆解参考文章':'等待章节框架',label:'语义拆解',subtitle:'真实章节返回后，会在这里逐步展开。',state:j.status==='failed'?'需要处理':'等待',active:j.status==='segmenting'}),edges.push({from:'root',to:'waiting'});
  return {nodes,edges,width:2520,height};
 }
 function currentSectionDraft(j,s){const marker='## '+s.heading+'\n',at=j.draft?.indexOf(marker);if(at>=0){const tail=j.draft.slice(at+marker.length),m=/\n## [^\n]+\n/.exec(tail);return(m?tail.slice(0,m.index):tail).trim();}return s.draft||'';}
 globalThis.KnowFlowCanvasModel={graph,activeSection,sectionState,running,currentSectionDraft};
})();
