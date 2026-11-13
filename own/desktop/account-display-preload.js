;(()=>{
 if(globalThis.location?.protocol!=='app:'||location.host!=='-'||location.pathname!=='/index.html'||window!==window.top)return;
 const {ipcRenderer,contextBridge}=require('electron'),channel='codex-own:account-display:v1';
 contextBridge.exposeInMainWorld('codexOwnImageSettings',Object.freeze({read:()=>ipcRenderer.invoke(channel,'image-settings'),save:(provider,model)=>ipcRenderer.invoke(channel,'save-image-settings',{provider,model})}));
 contextBridge.exposeInMainWorld('codexOwnAccountSettings',Object.freeze({read:()=>ipcRenderer.invoke(channel,'status'),logout:()=>ipcRenderer.invoke(channel,'logout'),restart:()=>ipcRenderer.invoke(channel,'restart')}));
 let state={phase:'checking',authenticated:false},badge,avatar,label,overlay,title,description,action,code,cancel;
 const inertBefore=new Map();
 const invoke=action=>ipcRenderer.invoke(channel,action).catch(()=>{});
 const open=()=>invoke(state.authenticated?'settings':'login');
 function place(){
  if(!document.body||!badge)return;
  const native=document.querySelector('button[aria-label="打开个人资料菜单"],button[aria-label="Open profile menu"]');
  const rail=process.platform==='win32'?document.querySelector('[data-app-navigation-rail]'):null;
  if(rail){
   if(native){native.style.setProperty('display','none','important');native.setAttribute('aria-hidden','true');native.tabIndex=-1;}
   for(const button of rail.querySelectorAll('button'))if(button!==badge&&['设置','Settings'].includes(button.textContent.trim())){button.style.setProperty('display','none','important');button.setAttribute('aria-hidden','true');button.tabIndex=-1;}
   if(badge.parentElement!==rail)rail.append(badge);
   badge.style.position='static';badge.style.width='100%';badge.style.marginTop='auto';badge.style.flexShrink='0';badge.style.boxShadow='none';label.style.maxWidth='100%';
  }else if(native?.parentElement){
   native.style.setProperty('display','none','important');native.setAttribute('aria-hidden','true');native.tabIndex=-1;
   if(badge.parentElement!==native.parentElement)native.parentElement.append(badge);
   badge.style.position='static';badge.style.width='100%';badge.style.boxShadow='none';
  }else if(badge.parentElement!==document.body){document.body.append(badge);badge.style.position='fixed';badge.style.left='12px';badge.style.bottom='12px';badge.style.width='76px';}
  if(overlay.parentElement!==document.body)document.body.append(overlay);
  const blocked=state.authenticated!==true||state.restartRequired===true;
  for(const node of document.body.children){
   if(node===overlay||node===badge||['STYLE','SCRIPT'].includes(node.tagName))continue;
   if(blocked){if(!inertBefore.has(node))inertBefore.set(node,node.inert);node.inert=true;}
   else if(inertBefore.has(node)){node.inert=inertBefore.get(node);inertBefore.delete(node);}
  }
 }
 function render(next){
  state=next||state;if(!badge)return;
  const authenticated=state.authenticated===true,name=authenticated?String(state.name||'企业账号'):'';
  const checking=state.phase==='checking'||state.phase==='idle',waiting=state.phase==='waiting',failed=state.phase==='error';
  avatar.textContent=authenticated?Array.from(name)[0]:checking?'…':'登录';label.textContent=authenticated?name:checking?'验证中':failed?'待验证':'未登录';
  badge.setAttribute('aria-label',authenticated?'企业账号：'+name:'未登录，使用东轩AI授权');badge.title=authenticated?'东轩AI授权 · '+name:'东轩AI授权 · 需要登录';
  avatar.style.background=authenticated?'#21734a':'#3769df';
  overlay.hidden=authenticated&&!state.restartRequired;
  title.textContent=authenticated?'登录成功':checking?'正在检查登录状态':'请先登录 codex-own';
  description.textContent=authenticated?'企业账号已验证，请重启应用，使用本机直连模型和个人工具。':checking?'正在验证东轩企业账号。':waiting?'请在浏览器中完成东轩AI授权，然后返回应用。':failed?'暂时无法验证登录状态，请检查网络后重试。':'使用东轩企业钉钉账号登录，自动配置文本模型直连和个人生图授权。';
  code.hidden=!waiting||!state.userCode;code.textContent=waiting?'校验码：'+String(state.userCode||''):'';cancel.hidden=!waiting;
  action.textContent=authenticated?'重启并使用':checking?'正在验证…':waiting?'等待浏览器授权…':'使用东轩AI授权登录';action.disabled=checking||waiting;
  place();
 }
 function mount(){
  if(badge)return;
  badge=document.createElement('button');badge.id='codex-own-account-badge';badge.type='button';badge.style.cssText='z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:52px;padding:7px 4px;border:0;border-radius:10px;background:transparent;color:inherit;cursor:pointer;font:11px system-ui;box-sizing:border-box';badge.onclick=open;
  avatar=document.createElement('span');avatar.setAttribute('aria-hidden','true');avatar.style.cssText='display:grid;place-items:center;width:28px;height:28px;border-radius:50%;color:white;font:600 12px system-ui';
  label=document.createElement('span');label.style.cssText='max-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';badge.append(avatar,label);
  overlay=document.createElement('section');overlay.id='codex-own-login-gate';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','东轩AI授权');
  overlay.style.cssText='position:fixed;inset:0;z-index:2147482999;background:light-dark(#f8f9fc,#1c1e22);color:light-dark(#20242c,#edf0f5);color-scheme:light dark;display:grid;place-items:center;font:15px system-ui';
  // hidden must take precedence over the explicit grid display.
  const css=document.createElement('style');css.textContent='#codex-own-login-gate[hidden]{display:none!important}';document.head.append(css);
  const card=document.createElement('div');card.style.cssText='max-width:400px;padding:36px;text-align:center';
  const brand=document.createElement('p');brand.textContent='东轩AI授权';brand.style.cssText='color:#6792ef;font-weight:600;letter-spacing:1px';
  title=document.createElement('h1');title.style.fontSize='26px';description=document.createElement('p');description.style.cssText='line-height:1.8;opacity:.8';
  action=document.createElement('button');action.type='button';action.style.cssText='margin-top:16px;padding:12px 24px;border:0;border-radius:9px;background:#3769df;color:white;font:600 15px system-ui;cursor:pointer';action.onclick=()=>ipcRenderer.invoke(channel,state.authenticated&&state.restartRequired?'restart':'login').catch(()=>{});
  code=document.createElement('p');code.style.cssText='font:700 23px monospace;letter-spacing:2px';
  cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消登录';cancel.style.cssText='display:block;margin:18px auto 0;border:0;background:transparent;color:inherit;font:14px system-ui;cursor:pointer';cancel.onclick=()=>ipcRenderer.invoke(channel,'cancel').catch(()=>{});
  card.append(brand,title,description,code,action,cancel);overlay.append(card);place();render(state);
  new MutationObserver(place).observe(document.body,{childList:true,subtree:true});
  ipcRenderer.invoke(channel,'status').then(render).catch(()=>render({phase:'error',authenticated:false}));
 }
 ipcRenderer.on(channel,(_event,value)=>render(value));
 if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
