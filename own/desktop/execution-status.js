function __ownExecutionStatus({threadId}){
 const [state,setState]=__ownReact.useState(null),[now,setNow]=__ownReact.useState(Date.now());
 __ownReact.useEffect(()=>{let disposed=false,timer,pending=false;setState(null);
  const poll=async()=>{if(pending)return;pending=true;try{const s=await globalThis.codexOwnExecutionTiming?.read(threadId);if(!disposed){setState(s);setNow(Date.now());}}catch{if(!disposed)setState(null);}finally{pending=false;if(!disposed)timer=setTimeout(poll,1000);}};
  void poll();return()=>{disposed=true;clearTimeout(timer);};
 },[threadId]);
 if(!state?.active)return null;
 const labels={runtime:'等待运行时下一步',preparing:'正在准备模型请求',authorizing:'正在校验模型访问权限',waiting_model:'等待模型首个响应',waiting_stream:'已连接模型，等待内容',receiving:'正在接收模型响应',reasoning:'模型正在推理',text_output:'正在输出回复',tool_arguments:'正在准备工具调用',tool:'等待工具执行结果',attention:'等待你的操作',request_failed:'模型请求失败，等待运行时处理'};
 const seconds=t=>Math.max(0,Math.floor((now-t)/1000)),elapsed=seconds(state.phaseStartedAt),total=seconds(state.startedAt);
 const tools=Object.values(state.tools||{}),toolNames={commandExecution:'命令',mcpToolCall:'MCP 工具',dynamicToolCall:'工具',fileChange:'文件修改',imageView:'图片读取',webSearch:'搜索'};
 const label=labels[state.phase]||'正在执行',detail=state.phase==='tool'&&tools.length?'（'+[...new Set(tools.map(t=>toolNames[t.type]||'工具'))].join('、')+'）':'';
 return __ownJsx.jsxs('div',{'data-own-execution-live':'',role:'status','aria-live':'polite',className:'text-sm text-token-text-secondary',style:{padding:'6px 0',fontVariantNumeric:'tabular-nums'},children:[
  __ownJsx.jsx('div',{children:label+detail+' · 本阶段 '+elapsed+' 秒 · 本轮 '+total+' 秒'}),
  elapsed>=30?__ownJsx.jsx('div',{style:{fontSize:12,opacity:.8},children:state.phase==='tool'?'工具仍在运行，尚未返回完成结果。':state.phase==='waiting_model'||state.phase==='waiting_stream'?'模型响应尚未到达，耗时已记录。':state.phase==='reasoning'?'模型仍在推理，尚未输出回复。':'当前阶段尚未完成，耗时已记录。'}):null
 ]});
}
function __ownComposerExecutionFrame(threadId,content){
 if(!__ownReact.isValidElement(content))return content;
 return __ownReact.cloneElement(content,{'data-own-native-execution':''},__ownJsx.jsx(__ownExecutionStatus,{threadId}),content.props.children);
}
