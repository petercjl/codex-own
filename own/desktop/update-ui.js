const api=window.codexOwnUpdates,$=id=>document.getElementById(id);
const labels={idle:'准备检查更新',checking:'正在检查更新…',available:'发现新版本',current:'当前已是最新版本',downloading:'正在下载更新…',ready:'更新已下载，可以重启安装',installing:'正在退出并安装更新…',error:'更新未完成，可以重试'};
function render(s){
 $('versions').textContent=`当前版本：${s.current}${s.available?'　最新版本：'+s.available:''}`;
 $('status').textContent=labels[s.phase]||labels.idle;
 $('progress').textContent=s.message||'';
 const busy=['checking','downloading','installing'].includes(s.phase);
 $('check').disabled=busy;$('check').hidden=s.phase==='ready';
 $('download').hidden=!s.updateAvailable||busy||s.phase==='ready';
 $('install').hidden=s.phase!=='ready';
}
api.listen(render);
for(const [id,action]of [['check','check'],['download','download'],['install','install']])$(id).onclick=()=>api.action(action).then(render).catch(()=>{$('status').textContent='操作暂不可用，请重新打开更新窗口';});
api.action('state').then(render);
