import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {config,loadSettings} from '../src/config.mjs';

test('local settings override public defaults and relative paths resolve from project root',()=>{
 const root=fs.mkdtempSync(path.join(config.tempDir,'knowflow-settings-'));
 fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({port:54280,outputDir:'./outputs',profileDir:'./private/main',tempDir:'./temp',headless:false}));
 assert.equal(loadSettings(root).port,54280);
 fs.writeFileSync(path.join(root,'settings.local.json'),JSON.stringify({port:54328,headless:true,profileDir:'./private/isolated'}));
 const settings=loadSettings(root);
 assert.equal(settings.port,54328);assert.equal(settings.headless,true);
 assert.equal(settings.outputDir,path.join(root,'outputs'));
 assert.equal(settings.profileDir,path.join(root,'private/isolated'));
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'settings.json'))).port,54280);
});
