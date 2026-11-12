'use strict';
const el=id=>document.getElementById(id),api=window.codexOwnAccount;
function render(state){
 const waiting=state.phase==='waiting';el('login').disabled=waiting;
 el('login').hidden=state.authenticated===true;el('cancel').hidden=!waiting;el('logout').hidden=!state.authenticated;el('restart').hidden=!state.restartRequired;
 el('identity').textContent=state.authenticated?'当前账号：'+(state.name||'钉钉用户'):'';
 el('status').textContent=state.message||(state.authenticated?'已登录，可使用公司授权的模型。':'请使用东轩企业钉钉账号登录。');
 el('code').hidden=!state.userCode;el('code').textContent=state.userCode||'';
}
async function action(name,input){try{render(await api.action(name,input));}catch{el('status').textContent='操作未完成，请稍后重试。';}}
el('login').onclick=()=>action('login');
for(const name of ['cancel','logout','restart'])el(name).onclick=()=>action(name);
api.listen(render);action('status');
