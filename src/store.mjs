import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {ROOT} from './config.mjs';
export class Store{
 constructor(file=path.join(ROOT,'data','hub.sqlite')){
  this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS task(id TEXT PRIMARY KEY,created_at TEXT,payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS item(task_id TEXT,platform TEXT,source_id TEXT,payload TEXT NOT NULL,PRIMARY KEY(task_id,platform,source_id));
   CREATE TABLE IF NOT EXISTS event(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT,at TEXT,payload TEXT);
   CREATE TABLE IF NOT EXISTS protection(platform TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS detail_job(task_id TEXT,platform TEXT,source_id TEXT,payload TEXT NOT NULL,PRIMARY KEY(task_id,platform,source_id));`);
 }
 saveTask(t){this.db.prepare('INSERT INTO task VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(t.id,t.createdAt,JSON.stringify(t));return t;}
 tasks(){return this.db.prepare('SELECT payload FROM task ORDER BY created_at DESC LIMIT 100').all().map(r=>JSON.parse(r.payload));}
 task(id){const r=this.db.prepare('SELECT payload FROM task WHERE id=?').get(id);return r?JSON.parse(r.payload):null;}
 item(t,item){this.db.prepare('INSERT INTO item VALUES(?,?,?,?) ON CONFLICT(task_id,platform,source_id) DO UPDATE SET payload=excluded.payload').run(t,item.platform,item.sourceId,JSON.stringify(item));}
 items(id){return this.db.prepare('SELECT payload FROM item WHERE task_id=?').all(id).map(r=>JSON.parse(r.payload));}
 allItems(){return this.db.prepare('SELECT payload FROM item ORDER BY rowid DESC LIMIT 20000').all().map(r=>JSON.parse(r.payload));}
 event(id,data){const e={at:new Date().toISOString(),...data};this.db.prepare('INSERT INTO event(task_id,at,payload) VALUES(?,?,?)').run(id,e.at,JSON.stringify(e));return e;}
 events(id){return this.db.prepare('SELECT payload FROM event WHERE task_id=? ORDER BY id DESC LIMIT 200').all(id).map(r=>JSON.parse(r.payload));}
 protect(platform,data){this.db.prepare('INSERT INTO protection VALUES(?,?) ON CONFLICT(platform) DO UPDATE SET payload=excluded.payload').run(platform,JSON.stringify(data));}
 protection(platform){const r=this.db.prepare('SELECT payload FROM protection WHERE platform=?').get(platform);return r?JSON.parse(r.payload):null;}
 queueDetail(taskId,job){this.db.prepare('INSERT OR IGNORE INTO detail_job VALUES(?,?,?,?)').run(taskId,job.platform,job.sourceId,JSON.stringify(job));}
 detailJobs(taskId,platform='zhihu'){return this.db.prepare('SELECT payload FROM detail_job WHERE task_id=? AND platform=? ORDER BY rowid').all(taskId,platform).map(r=>JSON.parse(r.payload));}
 saveDetailJob(taskId,job){this.db.prepare('UPDATE detail_job SET payload=? WHERE task_id=? AND platform=? AND source_id=?').run(JSON.stringify(job),taskId,job.platform,job.sourceId);}
 close(){this.db.close();}
}
