import test from 'node:test';
import assert from 'node:assert/strict';
import {zhihuBrowserOptions} from '../src/browser.mjs';
test('explicit detail executable changes only anonymous detail, preserving list browser',()=>{
 const settings={browserChannel:'msedge',headless:false,tempDir:'E:/fixture/temp',zhihuDetailExecutablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'};
 const detail=zhihuBrowserOptions('detail',settings),list=zhihuBrowserOptions('list',settings);
 assert.equal(detail.executablePath,settings.zhihuDetailExecutablePath);assert.equal('channel' in detail,false);assert.equal(detail.downloadsPath,settings.tempDir);assert.equal(list.channel,'msedge');assert.equal('executablePath' in list,false);
});
test('unset detail executable retains configured browser without changing role isolation',()=>{assert.deepEqual(zhihuBrowserOptions('detail',{browserChannel:'msedge',headless:true,tempDir:'E:/fixture/temp'}),{channel:'msedge',headless:true,downloadsPath:'E:/fixture/temp'});});
