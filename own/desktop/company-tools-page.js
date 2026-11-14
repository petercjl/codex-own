function __codexOwnCompanyTools(){
 const h=__JSX__.jsx,hs=__JSX__.jsxs;
 const [state,setState]=__REACT__.useState(null),[error,setError]=__REACT__.useState(''),[query,setQuery]=__REACT__.useState('');
 const bridge=globalThis.codexOwnCompanyTools;
 __REACT__.useEffect(()=>{let alive=true;const accept=s=>{if(alive)setState(s);},failed=()=>{if(alive)setError('暂时无法读取工具集，请重新打开此页面。');};if(!bridge){failed();return;}bridge.read().then(accept,failed);const off=bridge.subscribe(accept),timer=setInterval(()=>bridge.read().then(accept,failed),3000);return()=>{alive=false;off();clearInterval(timer);};},[]);
 const action=async fn=>{setError('');try{const value=await fn();if(value?.contract===1)setState(value);}catch(e){setError('操作未完成，请稍后重试。');}};
 const button=(label,fn,disabled=false)=>h('button',{type:'button',disabled,onClick:()=>action(fn),style:{border:'1px solid var(--color-token-border-default, #8885)',borderRadius:8,padding:'7px 14px',opacity:disabled?.5:1,cursor:disabled?'default':'pointer'},children:label});
 const muted={color:'var(--color-token-text-secondary, #888)'},card={border:'1px solid var(--color-token-border-default, #8884)',borderRadius:14,padding:24};
 const packages=new Map((state?.members||[]).map(row=>[row.package,{...row,skills:[...(row.skills||[])]}]));
 for(const skill of state?.skills||[]){let row=packages.get(skill.package);if(!row){row={package:skill.package,version:skill.version,available:skill.package===state.package?state.availableVersion:null,cli:[],skills:[]};packages.set(skill.package,row);}if(!row.skills.some(s=>s.name===skill.name))row.skills.push(skill);}
 const different=row=>!!row.available&&row.available!==row.version;
 const newer=row=>/^\d+\.\d+\.\d+$/.test(row.version||'')&&/^\d+\.\d+\.\d+$/.test(row.available||'')&&row.available.localeCompare(row.version,undefined,{numeric:true})>0;
 const q=query.trim().toLowerCase(),filtered=[...packages.values()].filter(row=>[row.package,...(row.cli||[]),...row.skills.flatMap(s=>[s.name,s.label])].join(' ').toLowerCase().includes(q));
 const recoveryErrors=['COLLECTION_LINK','COLLECTION_LOCAL_EDITS','COLLECTION_FILE_TYPE','COLLECTION_RECOVERY_REQUIRED'];
 const errorMessages={COLLECTION_LINK:'检测到工具独立更新器留下的符号链接。请保存冲突现场并恢复集合版本后继续。',COLLECTION_LOCAL_EDITS:'工具集文件与当前集合不一致。恢复会保留完整现场及用户修改，再恢复集合管理的版本。',COLLECTION_CHANNEL_SCOPE:'渠道切换影响了其他工具，已停止启用，当前版本保持可用。',COLLECTION_RECOVERY_REQUIRED:'存在未完成的恢复事务，请重试恢复；无法确认归属的现场将继续保留。',COLLECTION_CHANNEL_UNSUPPORTED:'当前工具集版本尚不支持渠道切换，请先更新工具集。',CHANNEL_UNAVAILABLE:'该工具尚未发布所选渠道版本，当前版本保持可用。'};
 const phase=state?.busy?'正在处理':state?.pendingUpdate?'更新已下载':state?.phase==='available'?'发现更新':state?.installed?'已安装':'待安装';
 return hs('main',{'aria-label':'公司工具集',className:'h-full w-full overflow-y-auto bg-token-bg-primary text-token-text-primary',style:{padding:'40px 36px'},children:[
  hs('div',{style:{maxWidth:1000,margin:'0 auto'},children:[
   h('h1',{style:{fontSize:26,fontWeight:600,marginBottom:8},children:'公司工具集'}),
   h('p',{style:{...muted,marginBottom:28},children:'统一管理公司使用的 Skill 与 CLI，按工具集安装和更新。'}),
   error&&h('p',{role:'alert',style:{marginBottom:16,color:'var(--color-token-text-danger, #c44)'},children:error}),
   !state?h('p',{role:'status',children:'正在读取工具集…'}):hs('section',{style:card,children:[
    hs('div',{style:{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',flexWrap:'wrap'},children:[hs('div',{children:[h('h2',{style:{fontSize:20,fontWeight:600},children:state.name}),h('p',{style:{...muted,fontSize:13,marginTop:6},children:state.package})]}),h('span',{style:{...muted,fontSize:13},children:phase})]}),
    hs('div',{style:{display:'flex',gap:28,flexWrap:'wrap',margin:'24px 0'},children:[h('span',{children:'当前版本 '+(state.version||'尚未安装')}),h('span',{children:state.skillCount+' 个 Skill'}),h('span',{children:state.memberCount+' 个组件'})]}),
    state.availableVersion&&state.availableVersion!==state.version&&h('p',{style:{marginBottom:12},children:'可用版本 '+state.availableVersion}),
    hs('label',{style:{display:'flex',gap:10,alignItems:'center',marginBottom:8},children:[h('input',{type:'checkbox',checked:state.autoUpdate,disabled:state.busy,style:{appearance:'auto',WebkitAppearance:'checkbox',width:16,height:16,flexShrink:0,margin:0},onChange:e=>action(()=>bridge.setAutoUpdate(e.target.checked))}),'自动检查并更新']}),
    h('p',{style:{...muted,fontSize:13,marginBottom:20},children:'每 6 小时检查并更新；完成后立即生效，已运行的进程继续完成。'}),
    hs('div',{style:{display:'flex',gap:10,flexWrap:'wrap'},children:[button('检查更新',()=>bridge.check(),state.busy),button(state.pendingUpdate?'应用已下载的更新':state.installed?'更新工具集':'安装工具集',()=>bridge.update(),state.busy)]}),
    h('p',{style:{...muted,fontSize:12,marginTop:10},children:'每个工具默认使用 latest；选择 next 后仅切换该工具，校验通过后替换当前版本。切回 latest 可恢复正式版。检查更新：查询可用版本。更新工具集：下载、校验并立即启用。'}),
    h('p',{role:'status','aria-live':'polite',style:{...muted,fontSize:13,marginTop:16,minHeight:20},children:state.message||(state.pendingUpdate?'已有下载完成的更新，可立即应用。':state.checkedAt?'上次检查：'+new Date(state.checkedAt).toLocaleString():'尚未检查更新')}),
    state.progress&&hs('div',{style:{marginTop:8},children:[h('progress',{'aria-label':'工具集更新进度',max:state.progress.total||4,value:state.progress.indeterminate?undefined:state.progress.completed,style:{appearance:'auto',width:'100%',height:8}}),h('p',{style:{...muted,fontSize:12,marginTop:6},children:state.busy?'第 '+(state.progress.step||1)+' / '+(state.progress.total||4)+' 步 · '+(state.progress.indeterminate?'处理中…':'已完成前序步骤'):state.progress.phase==='failed'?'更新失败，可重试。':'操作完成'})]}),
    state.warning&&hs('div',{style:{marginTop:10},children:[h('p',{role:'alert',style:muted,children:state.warning}),button('重试刷新',()=>bridge.refresh(),state.busy)]}),
    state.error&&h('p',{role:'alert',style:muted,children:(errorMessages[state.error]||'上次更新未完成，可再次检查或更新。当前已安装的工具集继续可用。')+'（'+state.error+'）'}),
    recoveryErrors.includes(state.error)&&button('保留现场并恢复工具集',()=>bridge.recover(),state.busy),
    state.changes&&h('p',{style:{...muted,fontSize:13},children:'更新内容：新增 '+state.changes.added+' 个、升级 '+state.changes.upgraded+' 个、移除 '+state.changes.removed+' 个组件。'}),
    hs('div',{style:{borderTop:'1px solid var(--color-token-border-default, #8884)',marginTop:24,paddingTop:20},children:[
     hs('div',{style:{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:12},children:[h('strong',{style:{fontWeight:500},children:'npm 包 ('+packages.size+')'}),h('input',{'aria-label':'搜索工具集内容',placeholder:'搜索名称、包名、CLI 或 Skill',value:query,onChange:e=>setQuery(e.target.value),style:{marginLeft:'auto',border:'1px solid var(--color-token-border-default, #8885)',borderRadius:8,padding:'7px 10px',width:260,maxWidth:'100%'}})]}),
     h('div',{style:{overflowX:'auto'},children:hs('table',{'aria-label':'工具集 npm 包',style:{width:'100%',minWidth:760,tableLayout:'fixed',borderCollapse:'collapse',fontSize:12},children:[
      h('thead',{children:h('tr',{children:[['名称','18%'],['版本渠道','18%'],['npm 包','25%'],['能力类型','11%'],['当前版本','13%'],['可用版本','15%']].map(([label,width],index)=>h('th',{scope:'col',style:{...muted,width,textAlign:index>=3?'right':'left',fontWeight:500,padding:'8px 10px 8px 0',whiteSpace:'nowrap'},children:label},label))})}),
      h('tbody',{children:filtered.map(row=>{const updatable=row.channel==='next'?different(row):newer(row),name=row.skills[0]?.label||row.package,type=row.package===state.package?'工具集':row.cli?.length?(row.skills.length?'CLI + Skill':'CLI'):'Skill',details=[name,...(row.cli?.length?['CLI：'+row.cli.join('、')]:[]),'Skill：'+row.skills.map(s=>s.label||s.name).join('、')].join('\n'),columns=[name,row.package,type,row.version,row.available||'未检查'];const channelCell=h('td',{style:{padding:'6px 10px'},children:row.id?h('select',{'aria-label':name+'版本渠道',value:row.channel||'latest',disabled:state.busy||state.pendingUpdate,onChange:e=>action(()=>bridge.setComponentChannel(row.id,e.target.value)),style:{border:'1px solid var(--color-token-border-default, #8885)',borderRadius:6,padding:5,appearance:'auto',WebkitAppearance:'menulist',color:'var(--color-token-text-primary, CanvasText)',background:'var(--color-token-bg-primary, Canvas)',width:124,maxWidth:'100%'},children:[h('option',{value:'latest',children:'正式版 latest'}),h('option',{value:'next',children:'测试版 next'})]}):'latest'});return h('tr',{style:{borderTop:'1px solid var(--color-token-border-default, #8883)',background:updatable?'rgba(34, 197, 94, .06)':undefined},children:[...columns.map((value,index)=>h('td',{title:index===0?details:index===4&&updatable?value+' · 可更新':value,style:{...(index===0?{fontWeight:500}:muted),height:36,padding:'6px 10px 6px 0',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',textAlign:index>=3?'right':'left',fontVariantNumeric:'tabular-nums'},children:index===4&&updatable?hs('span',{style:{color:'var(--color-text-success, #16803c)',fontWeight:600},children:[value,h('span',{style:{fontSize:11,marginLeft:6},children:'↑ 可更新'})]}):value},index))].flatMap((cell,index)=>index===0?[cell,channelCell]:[cell])},row.package);})})
     ]})}),
     !filtered.length&&h('p',{style:muted,children:q?'没有匹配的内容。':'安装后将在这里显示工具集内容。'})
    ]})
   ]})
  ]})
 ]});
}
