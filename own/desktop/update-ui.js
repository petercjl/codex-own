const api=window.codexOwnUpdates,$=id=>document.getElementById(id);
const labels={idle:'准备检查更新',checking:'正在检查更新…',available:'发现新版本',current:'当前已是最新版本',downloading:'正在下载更新…',ready:'更新已下载，可以重启安装',installing:'正在退出并安装更新…',error:'更新未完成，可以重试'};
function render(s){
 $('versions').textContent=`桌面：${s.current}${s.available&&s.available!==s.current?' → '+s.available:''}${s.managerAvailable?'　发布包：'+s.managerAvailable:''}${s.runtimeVersion?'\n工具：'+s.runtimeVersion:''}`;
 $('status').textContent=s.phase==='available'&&s.desktopUpdate===false&&s.runtimeUpdate?'发现独立工具更新':labels[s.phase]||labels.idle;
 $('progress').textContent=s.message||'';
 const cleanup=s.cleanup;
 $('cleanup').textContent=cleanup?.ok===true&&!cleanup.deferred?`本次启动已清理 ${(cleanup.reclaimedBytes/1048576).toFixed(1)} MiB · ${cleanup.rollbackRetained?'已保留最近一次完整回滚备份':'当前无旧版本回滚备份'}${cleanup.warnings?.length?' · 部分文件已保留，可稍后检查':''}${cleanup.cacheLimitExceeded?' · 部分缓存暂时保留':''}`:cleanup?.ok===false?'自动清理暂未完成，更新和当前应用仍可正常使用。':'';
 $('cleanup').hidden=!$('cleanup').textContent;
 const busy=['checking','downloading','installing'].includes(s.phase);
 $('check').disabled=busy;$('check').hidden=s.phase==='ready';
 $('download').hidden=!s.updateAvailable||busy||s.phase==='ready';
 $('install').hidden=s.phase!=='ready';
}
api.listen(render);
for(const [id,action]of [['check','check'],['download','download'],['install','install']])$(id).onclick=()=>api.action(action).then(render).catch(()=>{$('status').textContent='操作暂不可用，请重新打开更新窗口';});
api.action('state').then(render);
