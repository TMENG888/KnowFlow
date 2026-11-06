export class Semaphore{
 constructor(limit=1){this.limit=Math.max(1,Math.floor(limit));this.active=0;this.queue=[];}
 acquire(signal){
  if(signal?.aborted)return Promise.reject(new Error('STOP_REQUESTED'));
  return new Promise((resolve,reject)=>{
   const job={resolve,reject,signal};
   job.abort=()=>{const i=this.queue.indexOf(job);if(i>=0)this.queue.splice(i,1);reject(new Error('STOP_REQUESTED'));};
   signal?.addEventListener('abort',job.abort,{once:true});this.queue.push(job);this.drain();
  });
 }
 drain(){while(this.active<this.limit&&this.queue.length){const job=this.queue.shift();job.signal?.removeEventListener('abort',job.abort);if(job.signal?.aborted){job.reject(new Error('STOP_REQUESTED'));continue;}this.active++;let done=false;job.resolve(()=>{if(done)return;done=true;this.active--;this.drain();});}}
 async run(fn,signal){const release=await this.acquire(signal);try{if(signal?.aborted)throw new Error('STOP_REQUESTED');return await fn();}finally{release();}}
}
