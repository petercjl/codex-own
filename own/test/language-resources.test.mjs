import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {restrictLocaleCatalogs,planLanguageResources,pruneLanguageHeader} from '../builders/language-resources.mjs';
const require=createRequire(import.meta.url),policy=require('../lib/ui-locale.cjs');
const catalogue='const locales={"../locales/zh-CN.json":()=>import("./zh-CN.js"),"../locales/fr-FR.json":()=>import("./fr-FR.js")};function canonical(locale){try{return Intl.getCanonicalLocales(locale)[0]??locale}catch{return locale}}';

test('locale catalog and canonical UI selection retain Chinese and built-in English with a stable old-preference fallback',()=>{
 const result=restrictLocaleCatalogs(catalogue),context={};
 vm.runInNewContext(result.source+';this.locales=locales;this.canonical=canonical',context);
 assert.deepEqual(Object.keys(context.locales),['../locales/zh-CN.json']);
 for(const input of ['fr-FR','de-DE','en-GB',undefined])assert.equal(context.canonical(input),'en-US');
 for(const input of ['zh-CN','zh_HK','zh-TW','zh-Hans'])assert.equal(context.canonical(input),'zh-CN');
 assert.deepEqual(result.removedImports,['./fr-FR.js']);
 assert.equal(restrictLocaleCatalogs(result.source).source,result.source);
});

function archive(extra={}){
 const files={'webview/assets/main.js':catalogue,'webview/assets/zh-CN.js':'export default {hello:"你好"}',
  'webview/assets/fr-FR.js':'export default {hello:"Bonjour"}','webview/assets/cs-grammar.js':'export default "grammar"',
  'native-menu-locales/zh-CN.json':'{}','native-menu-locales/fr-FR.json':'{}',...extra};
 return {listPackage:()=>Object.keys(files),extractFile:(_archive,file)=>Buffer.from(files[file.replaceAll('\\','/')]),statFile:(_archive,file)=>({size:Buffer.byteLength(files[file.replaceAll('\\','/')])})};
}
test('language removal follows actual import catalogs and retains editor grammars and externally shared modules',()=>{
 const plan=planLanguageResources(archive(),'fixture');
 assert(plan.removed.has('webview/assets/fr-FR.js'));assert(plan.removed.has('native-menu-locales/fr-FR.json'));
 assert(!plan.removed.has('webview/assets/zh-CN.js'));assert(!plan.removed.has('webview/assets/cs-grammar.js'));
 const shared=planLanguageResources(archive({'webview/assets/component.js':'import data from "./fr-FR.js";export default data'}),'fixture');
 assert(!shared.removed.has('webview/assets/fr-FR.js'));assert.deepEqual(shared.report.retainedSharedModules,['webview/assets/fr-FR.js']);
});
test('archive header removal refuses links and unpacked entries before deleting any resource',()=>{
 const header={files:{safe:{size:1},linked:{link:'safe'}}};
 assert.throws(()=>pruneLanguageHeader(header,new Set(['safe','linked'])),/Unsupported language archive/);
 assert(header.files.safe);pruneLanguageHeader(header,new Set(['safe']));assert(!header.files.safe);assert(header.files.linked);
});
test('numeric Rspack locale chunks are removed through their loader IDs and preserved when another feature uses them',()=>{
 const source=catalogue.replace('import("./fr-FR.js")','r.e(2).then(r.t.bind(r,"fr",19))');
 const extra={'webview/assets/main.js':source,'webview/assets/async/2.abc.js':'export const __rspack_esm_ids=[2];export const __webpack_modules__={fr(e){e.exports=JSON.parse(\'{"sidebarElectron.productMode.trigger":"Bonjour"}\')}};'};
 const plan=planLanguageResources(archive(extra),'fixture');assert(plan.removed.has('webview/assets/async/2.abc.js'));
 for(const use of ['function load(){return r.e(2)}','const data=r("fr")']){const shared=planLanguageResources(archive({...extra,'webview/assets/feature.js':use}),'fixture');assert(!shared.removed.has('webview/assets/async/2.abc.js'));}
});
test('native menu locale normalization is idempotent and does not change unrelated OS locale information',()=>{
 const app={getLocale:()=> 'fr-FR',getPreferredSystemLanguages:()=>['zh-TW','en-GB','fr-FR'],getSystemLocale:()=> 'fr-FR'};
 policy.install(app);const installed=app.getLocale;policy.install(app);assert.equal(app.getLocale,installed);
 assert.equal(app.getLocale(),'en-US');assert.deepEqual(app.getPreferredSystemLanguages(),['zh-CN','en-US']);assert.equal(app.getSystemLocale(),'fr-FR');
});

test('main workbench locale fallback is normalized when its catalogue lives in another chunk',()=>{
 const source='const localeOverride="fr-FR";function canonical(locale){try{return Intl.getCanonicalLocales(locale)[0]??locale}catch{return locale}}';
 const result=restrictLocaleCatalogs(source),context={};vm.runInNewContext(result.source+';this.locale=canonical(localeOverride);this.chinese=canonical("zh-TW")',context);assert.equal(context.locale,'en-US');assert.equal(context.chinese,'zh-CN');assert.equal(result.canonicalizers,1);assert.equal(restrictLocaleCatalogs(result.source).source,result.source);
});
