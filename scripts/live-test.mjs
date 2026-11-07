import fs from 'node:fs/promises';
import {config,PLATFORMS} from '../src/config.mjs';
const base=`http://${config.host}:${config.port}`;
const response=await fetch(base+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword:'什么是React agent？',platforms:Object.keys(PLATFORMS),target:3,transcribeVideos:true})});
const task=await response.json();if(!response.ok)throw new Error(JSON.stringify(task));console.log('TASK '+task.id);
await fs.writeFile(config.outputDir+'/live-task.json',JSON.stringify(task,null,2));
let last='';
while(true){const data=await(await fetch(base+'/api/tasks/'+task.id)).json();const current=data.task.stages.map(s=>`${s.platform}: ${s.status} ${s.accepted}/${s.target} ${s.message}`).join('\n');if(current!==last){console.log(current);last=current;}
 if(!['running','queued'].includes(data.task.status)){await fs.writeFile(config.outputDir+'/live-test-result.json',JSON.stringify(data,null,2));console.log('FINAL '+data.task.status);break;}await new Promise(r=>setTimeout(r,4000));}
