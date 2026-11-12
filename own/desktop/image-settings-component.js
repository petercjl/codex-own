function __codexOwnImageSettings(){
 const [settings,setSettings]=__REACT__.useState(null),[message,setMessage]=__REACT__.useState(''),[busy,setBusy]=__REACT__.useState(false);
 __REACT__.useEffect(()=>{let active=true;globalThis.codexOwnImageSettings.read().then(value=>{if(active)setSettings(value);}).catch(()=>{if(active)setMessage('无法读取生图设置，请稍后重试。');});return()=>{active=false;};},[]);
 const save=async(event,field='provider')=>{const value=event.target.value;setBusy(true);try{setSettings(await globalThis.codexOwnImageSettings.save(field==='provider'?value:settings.provider,field==='model'?value:settings.model));setMessage('已保存，下一次图片请求即使用此设置。');}catch{setMessage('保存失败，请稍后重试。');}finally{setBusy(false);}};
 return __JSX__.jsxs(__GROUP__.X,{children:[
  __JSX__.jsx(__GROUP__.X.Header,{title:'生图'}),
  __JSX__.jsxs(__GROUP__.X.Content,{children:[
   __JSX__.jsx(__ROW__.ic,{label:'生图方式',description:'生成和编辑图片时使用的服务，适用于现有和新聊天。',control:__JSX__.jsx('select',{'aria-label':'生图方式',className:'rounded-lg border border-token-border-default bg-token-bg-primary px-3 py-2 text-sm text-token-text-primary',value:settings?.provider||'toapiscli',disabled:busy||!settings,onChange:save,children:(settings?.providers||[{id:'toapiscli',label:'ToAPIs（内置）'}]).map(provider=>__JSX__.jsx('option',{value:provider.id,children:provider.label},provider.id))})}),
   __JSX__.jsx(__ROW__.ic,{label:'默认生图模型',description:'未在当前任务中指定模型时，使用此模型。',control:__JSX__.jsx('select',{'aria-label':'默认生图模型',className:'rounded-lg border border-token-border-default bg-token-bg-primary px-3 py-2 text-sm text-token-text-primary',value:settings?.model||'gpt-image-2.6-sunburst',disabled:busy||!settings,onChange:event=>save(event,'model'),children:(settings?.models||[{id:'gpt-image-2.6-sunburst',label:'GPT Image 2.6 Sunburst'}]).map(model=>__JSX__.jsx('option',{value:model.id,children:model.label},model.id))})}),
   message?__JSX__.jsx('p',{role:'status',className:'text-sm text-token-text-secondary',children:message}):null
  ]})
 ]});
}
function __codexOwnAccountSettings(){
 const [account,setAccount]=__REACT__.useState(null),[busy,setBusy]=__REACT__.useState(false),[message,setMessage]=__REACT__.useState('');
 __REACT__.useEffect(()=>{let active=true;globalThis.codexOwnAccountSettings.read().then(value=>{if(active)setAccount(value);}).catch(()=>{if(active)setMessage('无法读取账户状态，请稍后重试。');});return()=>{active=false;};},[]);
 const action=async name=>{setBusy(true);try{setAccount(await globalThis.codexOwnAccountSettings[name]());}catch{setMessage('操作未完成，请稍后重试。');}finally{setBusy(false);}};
 return __JSX__.jsxs(__GROUP__.X,{children:[
  __JSX__.jsx(__GROUP__.X.Header,{title:'账户'}),
  __JSX__.jsxs(__GROUP__.X.Content,{children:[
   __JSX__.jsx(__ROW__.ic,{label:'东轩AI授权',description:account?.authenticated?'当前账号：'+account.name:'正在检查企业账号…',control:__JSX__.jsx('button',{type:'button',className:'rounded-lg border border-token-border-default px-3 py-2 text-sm',disabled:busy||!account?.authenticated,onClick:()=>action('logout'),children:'退出登录'})}),
   account?.restartRequired?__JSX__.jsx('button',{type:'button',disabled:busy,onClick:()=>action('restart'),children:'重启应用'}):null,
   message?__JSX__.jsx('p',{role:'status',className:'text-sm text-token-text-secondary',children:message}):null
  ]})
 ]});
}
