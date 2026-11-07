import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function loadSettings(root=ROOT){
 const defaults=JSON.parse(fs.readFileSync(path.join(root,'settings.json'),'utf8'));
 const localPath=path.join(root,'settings.local.json');
 const local=fs.existsSync(localPath)?JSON.parse(fs.readFileSync(localPath,'utf8')):{};
 const settings={...defaults,...local};
 for(const key of ['outputDir','profileDir','tempDir','zhihuListProfileDir','zhihuDetailProfileDir','asrModel','pythonSite','playwrightFallback'])if(settings[key])settings[key]=path.resolve(root,settings[key]);
 return settings;
}
export const config=loadSettings();
for(const dir of [config.outputDir,config.profileDir,config.tempDir,path.join(ROOT,'data')])fs.mkdirSync(dir,{recursive:true});
// Windows' standard process-scoped temp variables keep Playwright's transient
// browser profiles on E:, without changing machine or user environment settings.
if(process.platform==='win32'){process.env.TEMP=path.resolve(config.tempDir);process.env.TMP=path.resolve(config.tempDir);}
export function getPlaywright(){
 const require=createRequire(import.meta.url);
 try{return require('playwright');}catch{if(config.playwrightFallback)return createRequire(config.playwrightFallback)('playwright');throw new Error('请先运行 npm install 安装 Playwright');}
}
export const PLATFORMS={
 bilibili:{name:'B站',home:'https://www.bilibili.com/',hosts:['bilibili.com'],search:q=>'https://search.bilibili.com/all?keyword='+encodeURIComponent(q)},
 douyin:{name:'抖音',home:'https://www.douyin.com/',hosts:['douyin.com'],search:q=>'https://www.douyin.com/search/'+encodeURIComponent(q)+'?type=general'},
 xiaohongshu:{name:'小红书',home:'https://www.xiaohongshu.com/',hosts:['xiaohongshu.com'],search:q=>'https://www.xiaohongshu.com/search_result?keyword='+encodeURIComponent(q)+'&source=web_explore_feed'},
 toutiao:{name:'今日头条',home:'https://www.toutiao.com/',hosts:['toutiao.com'],search:q=>'https://so.toutiao.com/search?keyword='+encodeURIComponent(q)+'&pd=synthesis'},
 zhihu:{name:'知乎',home:'https://www.zhihu.com/',hosts:['zhihu.com'],search:q=>'https://www.zhihu.com/search?type=content&q='+encodeURIComponent(q)},
 csdn:{name:'CSDN',home:'https://www.csdn.net/',hosts:['csdn.net'],search:q=>'https://so.csdn.net/so/search?q='+encodeURIComponent(q)+'&t=blog'}
};
