export const WEIGHTS={likes:.3,comments:.3,favorites:.25,shares:.15};
export const SCORING_VERSION='empirical-global-fixed-weights-v2';
const validCount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function percentile(value,values){
 if(!validCount(value))return null;
 const arr=values.filter(validCount);if(arr.length<2)return null;
 if(value===0)return 0;
 const lo=arr.filter(v=>v<value).length,tie=arr.filter(v=>v===value).length;
 return (lo+tie*.5)/arr.length;
}
export function selectScoringCorpus(items,{now=Date.now(),windowDays=90}={}){
 const latest=new Map();
 for(const item of items){
  const at=Date.parse(item.collectedAt);
  if(!Number.isFinite(at)||at>now||now-at>=windowDays*86400000)continue;
  const key=item.platform+':'+item.sourceId,previous=latest.get(key);
  if(!previous||at>Date.parse(previous.collectedAt))latest.set(key,item);
 }
 return [...latest.values()].filter(i=>i.contentStatus!=='excluded');
}
export function scoreItems(items,{minSize=20,weights=WEIGHTS,version=SCORING_VERSION}={}){
 const entries=Object.entries(weights);
 if(!entries.length||entries.some(([,w])=>!Number.isFinite(w)||w<0))throw new Error('评分权重须为非负有限数');
 const total=entries.reduce((n,[,w])=>n+w,0);if(!total)throw new Error('评分权重总和须大于0');
 const references=Object.fromEntries(entries.map(([key])=>[key,items.map(i=>i.metrics?.[key]).filter(validCount)]));
 const scored=items.map(item=>{
  const components={};let sum=0,observed=0,used=0;
  for(const [key,weight]of entries){
   if(weight===0)continue;
   const value=item.metrics?.[key];if(!validCount(value))continue;observed+=weight;
   const valid=references[key],p=percentile(value,valid);
   components[key]={value,percentile:p,referenceN:valid.length,weight:weight/total,contribution:p===null?null:100*p*weight/total};
   if(p!==null){sum+=p*weight;used+=weight;}
  }
  // Unknown counts remain unknown. Their weight is never transferred to observed metrics.
  const score=used?Math.round(1000*sum/total)/10:null;
  const incomplete=used<total-1e-9;
  const smallSample=items.length<minSize||Object.values(components).some(c=>c.referenceN<minSize);
  return{...item,influence:{score,provisional:smallSample||incomplete,cohortN:items.length,metricCoverage:Math.round(observed/total*100),scoredWeight:Math.round(used/total*100),components,version,cohort:'all-platforms/all-types',missingPolicy:'fixed-weight-no-redistribution',label:score===null?'样本不足':smallSample?(incomplete?'试算·缺项':'试算'):incomplete?'缺项估计':'跨平台互动指数'}};
 });
 const ordered=scored.filter(i=>i.influence.score!==null).map(i=>i.influence.score).sort((a,b)=>b-a);
 const ranks=new Map();ordered.forEach((score,index)=>{if(!ranks.has(score))ranks.set(score,index+1);});
 for(const item of scored){item.influence.rank=ranks.get(item.influence.score)??null;item.influence.rankN=ordered.length;}
 return scored;
}
