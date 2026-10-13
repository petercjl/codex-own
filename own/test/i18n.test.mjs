import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {patchTranslationGate,inspectTranslations,verifyTranslations} from '../builders/i18n.mjs';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
test('enable translation independently of remote defaults and preserve locale choice',()=>{
  const source='let a=config?.get(`enable_i18n`,!1),b=config.get("enable_i18n",true);let locale=config.get("locale_source","IDE");';
  const patched=patchTranslationGate(source);
  assert.equal(patched.count,2);assert.match(patched.source,/let a=!0,b=!0/);
  assert.match(patched.source,/locale_source/);assert.equal(patchTranslationGate(patched.source).count,0);
  assert.equal(patchTranslationGate('let x=settings.get("unrelated",false)').count,0);
});
test('prepared desktop with visible selector but disabled translation fails release check',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'own-i18n-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source'),app=path.join(dir,'app'),resources=path.join(app,'resources');
  fs.mkdirSync(path.join(source,'webview','assets'),{recursive:true});fs.mkdirSync(path.join(source,'native-menu-locales'));
  for(const name of ['zh-CN-test.js','zh-Hans-test.js'])fs.writeFileSync(path.join(source,'webview','assets',name),'export default {}');
  fs.writeFileSync(path.join(source,'native-menu-locales','zh-CN.json'),'{}');
  const initial=path.join(source,'webview','assets','app-initial-test.js');
  fs.writeFileSync(initial,'const enabled=config?.get("enable_i18n",false);');
  fs.mkdirSync(resources,{recursive:true});const archive=path.join(resources,'app.asar');await asar.createPackage(source,archive);
  assert.equal(inspectTranslations(archive).gates.length,1);assert.throws(()=>verifyTranslations(app),{code:'I18N_NOT_READY'});
  fs.writeFileSync(initial,patchTranslationGate(fs.readFileSync(initial,'utf8')).source);await asar.createPackage(source,archive);
  assert.equal(verifyTranslations(app).ok,true);
  assert.equal(asar.statFile(archive,path.join('webview','assets','app-initial-test.js')).size,fs.statSync(initial).size);
});
