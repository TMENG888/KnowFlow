export const WEIGHTS={likes:.3,comments:.3,favorites:.25,shares:.15};
export function percentile(value,values){
 if(value===0)return 0;
 const arr=values.filter(v=>v!=null&&Number.isFinite(v)&&v>=0);if(arr.length<2)return null;
 const x=Math.log1p(value),lo=arr.filter(v=>Math.log1p(v)<x).length,tie=arr.filter(v=>Math.log1p(v)===x).length;
 return (lo+tie*.5)/arr.length;
}
export function scoreItems(items,{minSize=20,weights=WEIGHTS,version='empirical-platform-kind-v1'}={}){
 return items.map(item=>{
  const cohort=items.filter(x=>x.platform===item.platform&&x.kind===item.kind);
  const components={};let sum=0,observed=0,used=0;
  for(const [key,weight]of Object.entries(weights)){
   const value=item.metrics?.[key];if(value==null)continue;observed+=weight;
   const valid=cohort.map(x=>x.metrics?.[key]).filter(x=>x!=null&&Number.isFinite(x));
   const p=valid.length<2?null:percentile(value,valid);components[key]={value,percentile:p,referenceN:valid.length};
   if(p!==null){sum+=p*weight;used+=weight;}
  }
  const score=used?Math.round(1000*sum/used)/10:null;
  return{...item,influence:{score,provisional:cohort.length<minSize||Object.values(components).some(c=>c.referenceN<minSize),cohortN:cohort.length,metricCoverage:Math.round(observed*100),scoredWeight:Math.round(used*100),components,version,cohort:`${item.platform}/${item.kind}`,label:score===null?'样本不足':cohort.length<minSize?'试算':'样本内相对影响力'}};
 });
}
