import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {patchNativeImageSettings} from '../builders/native-image-settings.mjs';
const fixture=`const registry={module(e,t,a){a.d(t,{GeneralSettings:()=>General});var jsx=a('ABep'),proto=a('iRMi'),react=a('zd8w'),groups=a('BSnr'),rows=a('AWNZ');function General(){return jsx.jsxs('settings-page',{title:'常规',children:['original permissions','original appearance']});}}};registry.module(null,globalThis.exports,globalThis.load);`;
test('native settings retain all existing rows and gain a real image preference component',()=>{
 const patched=patchNativeImageSettings(fixture);assert(patched.patched);assert.equal(patchNativeImageSettings(patched.source).source,patched.source);
 const context={exports:{},load:Object.assign(name=>({ABep:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},iRMi:{},zd8w:{useState:value=>[value,()=>{}],useEffect:()=>{}},BSnr:{X:Object.assign(()=>{},{Header:()=>{},Content:()=>{}})},AWNZ:{ic:()=>{}}})[name],{d:(target,entries)=>{for(const [name,get]of Object.entries(entries))Object.defineProperty(target,name,{get});}})};
 vm.runInNewContext(patched.source,context);const page=context.exports.GeneralSettings();assert.equal(page.props.title,'常规');assert.equal(page.props.children.length,4);assert.equal(page.props.children[2],'original permissions');assert.equal(page.props.children[3],'original appearance');
 const account=page.props.children[0].type();assert.equal(account.props.children[0].props.title,'账户');assert.equal(account.props.children[1].props.children[0].props.control.props.children,'退出登录');
 const component=page.props.children[1].type();assert.equal(component.props.children[0].props.title,'生图');
 const row=component.props.children[1].props.children[0];assert.equal(row.props.label,'生图方式');assert.equal(row.props.control.props.value,'toapiscli');assert.equal(row.props.control.props['aria-label'],'生图方式');
});
test('changed native settings imports and page layout fail closed',()=>{
 assert.throws(()=>patchNativeImageSettings(fixture.replace("a('AWNZ')","a('unknown')")),/imports changed/);
 assert.throws(()=>patchNativeImageSettings(fixture.replace("children:['original permissions','original appearance']","children:'changed'")),/content contract changed/);
 assert.equal(patchNativeImageSettings('const unrelated=1;').patched,false);
});
