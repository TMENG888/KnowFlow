import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreItems,percentile,selectScoringCorpus,SCORING_VERSION} from '../src/scoring.mjs';
import {Store} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';

const mk=(platform,id,metrics,kind='video')=>({platform,sourceId:id,kind,metrics});
test('all platforms and kinds share references, ties and zeros retain declared behavior',()=>{
 const rows=scoreItems([mk('a','1',{likes:100},'article'),mk('a','2',{likes:1000}),mk('b','3',{likes:10}),mk('b','4',{likes:100},'image')]);
 assert.equal(rows[0].influence.score,15);assert.equal(rows[0].influence.score,rows[3].influence.score);
 assert.ok(rows[1].influence.score>rows[0].influence.score);assert.ok(rows[0].influence.score>rows[2].influence.score);
 assert.equal(rows[0].influence.components.likes.referenceN,4);assert.equal(rows[0].influence.cohort,'all-platforms/all-types');
 assert.equal(rows[0].influence.rank,2);assert.equal(rows[3].influence.rank,2);assert.equal(rows[2].influence.rank,4);
 assert.equal(rows[0].influence.rankN,4);assert.equal(percentile(7,[7,7,7]),.5);assert.equal(percentile(0,[0,0]),0);
});
test('unknown metrics do not gain redistributed weight or become observed zero',()=>{
 const metrics={likes:100,comments:100,favorites:100,shares:100};
 const rows=scoreItems([mk('csdn','sparse',{likes:100}),mk('douyin','full',metrics),mk('other','zero',{likes:0,comments:0,favorites:0,shares:0})]);
 const sparse=rows[0].influence,full=rows[1].influence;
 assert.equal(sparse.score,20);assert.ok(full.score>sparse.score);assert.equal(sparse.metricCoverage,30);assert.equal(sparse.scoredWeight,30);
 assert.equal(sparse.components.comments,undefined);assert.equal(rows[0].metrics.comments,undefined);
 assert.ok(sparse.score<=30);assert.match(sparse.label,/缺项/);assert.equal(sparse.version,SCORING_VERSION);
 assert.equal(rows[2].influence.score,0);assert.notEqual(rows[2].influence.rank,null);
});
test('no usable references yields no score or rank, invalid counts are not observations',()=>{
 const rows=scoreItems([mk('a','1',{likes:999,comments:-1,favorites:NaN,shares:Infinity}),mk('b','2',{})]);
 assert.equal(rows[0].influence.score,null);assert.equal(rows[0].influence.rank,null);assert.equal(rows[0].influence.rankN,0);
 assert.equal(rows[0].influence.metricCoverage,30);assert.equal(rows[0].influence.scoredWeight,0);
 assert.equal(percentile(-1,[1,2]),null);assert.equal(percentile(0,[0]),null);
});
test('fixed weights normalize by their total and reject invalid settings',()=>{
 const items=[mk('a','1',{likes:1}),mk('b','2',{likes:2})];
 assert.deepEqual(scoreItems(items,{weights:{likes:3,comments:7}}),scoreItems(items,{weights:{likes:.3,comments:.7}}));
 assert.throws(()=>scoreItems(items,{weights:{likes:0}}));assert.throws(()=>scoreItems(items,{weights:{likes:-1}}));
 assert.throws(()=>scoreItems(items,{weights:{likes:NaN}}));
});
test('large corpus with sparse single metric is still a provisional estimate',()=>{
 const rows=scoreItems(Array.from({length:25},(_,n)=>mk('a',String(n),{likes:n}))) ;
 assert.equal(rows[24].influence.provisional,true);assert.equal(rows[24].influence.label,'缺项估计');
 const full=scoreItems(Array.from({length:25},(_,n)=>mk('a',String(n),{likes:n,comments:n,favorites:n,shares:n})));
 assert.equal(full[24].influence.provisional,false);
});
test('window and latest observation dedup are based on collection time, including exclusion',()=>{
 const now=Date.parse('2026-11-07T00:00:00Z'),at=days=>new Date(now-days*86400000).toISOString();
 const sample=(id,days,extra={})=>({...mk('a',id,{likes:days}),collectedAt:at(days),...extra});
 const rows=selectScoringCorpus([sample('1',1),sample('1',2),sample('2',3),sample('2',1,{contentStatus:'excluded'}),sample('old',90),sample('future',-1),sample('invalid',1,{collectedAt:'bad'}),sample('1',1,{platform:'b'})],{now});
 assert.equal(rows.length,2);assert.equal(rows.find(i=>i.platform==='a').metrics.likes,1);
});
test('engine shares global rankings across task views and retains raw historical metrics',()=>{
 const store=new Store(':memory:'),at=new Date(Date.now()-1000).toISOString();
 store.item('one',{...mk('csdn','1',{likes:38},'image'),collectedAt:at});
 store.item('two',{...mk('douyin','2',{likes:2053,comments:94,favorites:1982,shares:332}),collectedAt:at});
 store.item('three',{...mk('douyin','3',{likes:2081,comments:62,favorites:2140,shares:393}),collectedAt:at});
 const engine=new Engine(store),sparse=engine.scored('one')[0],full=engine.scored('two')[0];
 assert.equal(sparse.influence.cohortN,3);assert.equal(full.influence.rankN,3);assert.ok(full.influence.score>sparse.influence.score);
 assert.equal(store.items('one')[0].influence,undefined);assert.equal(store.items('one')[0].metrics.likes,38);store.close();
});
