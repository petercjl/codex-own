Unicode true
RequestExecutionLevel user
SetCompressor /FINAL lzma
SetCompressorDictSize 32
SetCompress auto
!ifndef MODE
 !define MODE "offline"
!endif
!ifndef CHANNEL_LABEL
 !define CHANNEL_LABEL ""
!endif
Name "codex-own ${VERSION}${CHANNEL_LABEL}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\codex-own"
ShowInstDetails show
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
Var KeyFile
Var Parameters
Var Installing
Var VerifyOnly
!define MUI_CUSTOMFUNCTION_ABORT PreventInstallAbort
!if "${MODE}" == "online"
 !define MUI_WELCOMEPAGE_TEXT "安装 codex-own ${VERSION}。本安装器包含独立 Node、npm 和 Python，安装时联网下载桌面程序。$\r$\n$\r$\n无需预装开发工具；请预留至少 10 GB 空间，并完全退出 codex-own。已有配置与对话会保留。"
!else
 !define MUI_WELCOMEPAGE_TEXT "安装 codex-own ${VERSION}，包含完整桌面应用与独立 Node、npm、Python，可离线安装。$\r$\n$\r$\n无需预装开发工具；请预留至少 10 GB 空间，并完全退出 codex-own。已有配置与对话会保留。"
!endif
!insertmacro MUI_PAGE_WELCOME
Page custom AccountPage
!define MUI_PAGE_CUSTOMFUNCTION_PRE DisableCancel
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "codex-own 已安装。请在开始菜单中打开 codex-own。$\r$\n$\r$\n后续请使用应用内的“更新”菜单。首次打开后，按页面提示完成东轩AI授权并加载公司模型。点击左下角人名可打开设置。$\r$\n$\r$\n安装包文件在安装成功后可自行删除。"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
 SetShellVarContext current
 StrCpy $KeyFile ""
 System::Call 'kernel32::SetEnvironmentVariable(t "NODE_OPTIONS", p 0)'
 System::Call 'kernel32::SetEnvironmentVariable(t "NODE_PATH", p 0)'
 System::Call 'kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", p 0)'
 ${GetParameters} $Parameters
 ${GetOptions} $Parameters "/APIKEYFILE=" $KeyFile
 StrCpy $VerifyOnly 0
 ClearErrors
 ${GetOptions} $Parameters "/VERIFYONLY" $0
 IfErrors +2 0
 StrCpy $VerifyOnly 1
FunctionEnd
Function DisableCancel
 GetDlgItem $0 $HWNDPARENT 2
 EnableWindow $0 0
FunctionEnd
Function PreventInstallAbort
 ${If} $Installing == 1
  Abort
 ${EndIf}
FunctionEnd
Function AccountPage
 !insertmacro MUI_HEADER_TEXT "东轩AI授权与公司模型" "安装完成后，使用公司钉钉账号登录 codex-own。"
 nsDialogs::Create 1018
 Pop $0
 ${If} $0 == error
  Abort
 ${EndIf}
 ${NSD_CreateLabel} 0 0 100% 110u "首次打开后，按页面提示发起东轩AI授权。登录后点击左下角人名，在设置中管理账户和生图偏好。$\r$\n$\r$\n公司服务地址：https://codex.lumyne.cn$\r$\n$\r$\n在浏览器中完成钉钉授权，并核对应用窗口显示的校验码。企业身份验证通过后，可使用三个公司文本模型；生图使用本人专属配置。$\r$\n$\r$\n以后更新保留登录状态、配置与对话；凭证过期后重新登录。"
 Pop $0
 nsDialogs::Show
FunctionEnd

Section "安装 codex-own"
 StrCpy $Installing 1
 InitPluginsDir
 SetOutPath "$PLUGINSDIR\payload"
 SetCompress off
 File "${PAYLOAD}\node.zip"
 File "${PAYLOAD}\python.tar.gz"
 !if "${MODE}" == "offline"
  File "${PAYLOAD}\desktop.tar.gz"
 !endif
 SetCompress auto
 File /r /x desktop.tar.gz /x node.zip /x python.tar.gz "${PAYLOAD}\*"
 DetailPrint "正在准备已校验的安装运行环境…"
 nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\payload\bootstrap-node.ps1" -Payload "$PLUGINSDIR\payload"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  MessageBox MB_ICONSTOP "安装运行环境准备失败，请检查安装包完整性和可用空间。"
  SetErrorLevel 5
  Abort
 ${EndIf}
 DetailPrint "正在校验并安装完整资源，请耐心等待…"
 ${If} $VerifyOnly == 1
  nsExec::ExecToStack '"$PLUGINSDIR\payload\engine\node.exe" "$PLUGINSDIR\payload\offline-install.mjs" --verify-only'
 ${ElseIf} $KeyFile == ""
  nsExec::ExecToStack '"$PLUGINSDIR\payload\engine\node.exe" "$PLUGINSDIR\payload\offline-install.mjs"'
 ${Else}
  nsExec::ExecToStack '"$PLUGINSDIR\payload\engine\node.exe" "$PLUGINSDIR\payload\offline-install.mjs" --api-key-file "$KeyFile"'
 ${EndIf}
 Pop $0
 Pop $1
 StrCpy $Installing 0
 ${If} $0 != 0
  ${Switch} $0
   ${Case} 2
    MessageBox MB_ICONSTOP "请完全退出 codex-own，再重新运行安装器。"
    ${Break}
   ${Case} 3
    MessageBox MB_ICONSTOP "发现未登记或身份不匹配的旧安装，已保留原目录。请先使用已有修复入口处理。"
    ${Break}
   ${Case} 4
    MessageBox MB_ICONSTOP "当前应用比此安装包更新，请使用应用内更新或下载最新安装包。"
    ${Break}
   ${Case} 5
    MessageBox MB_ICONSTOP "安装资源校验失败，请重新下载完整安装包。"
    ${Break}
   ${Case} 6
    MessageBox MB_ICONSTOP "API 文件无效，请选择只包含 API 密钥的 txt 文件。"
    ${Break}
   ${Default}
    MessageBox MB_ICONSTOP "安装未完成。请检查可用磁盘空间、文件权限，并确认应用已完全退出后重试。"
  ${EndSwitch}
  SetErrorLevel $0
  Abort
 ${EndIf}
 ${If} $VerifyOnly == 1
  SetErrorLevel 0
  Quit
 ${EndIf}
 DetailPrint "完整资源安装和配置已完成。"
 SetOutPath "$INSTDIR"
 IfFileExists "$INSTDIR\Uninstall-codex-own.exe" 0 no_previous_uninstaller
 System::Call 'kernel32::GetTickCount() i.r0'
 IfFileExists "$INSTDIR\Uninstall-codex-own.exe.backup-$0" no_previous_uninstaller 0
 Rename "$INSTDIR\Uninstall-codex-own.exe" "$INSTDIR\Uninstall-codex-own.exe.backup-$0"
 no_previous_uninstaller:
 SetOverwrite off
 WriteUninstaller "$INSTDIR\Uninstall-codex-own.exe"
 SetOverwrite on
 SetOutPath "$INSTDIR\installer-support-${VERSION}"
 SetOverwrite off
 File "${PAYLOAD}\uninstall-check.cjs"
 SetOverwrite on
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\codex-own" "DisplayName" "codex-own"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\codex-own" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\codex-own" "DisplayIcon" "$INSTDIR\current\codex-own.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\codex-own" "UninstallString" '$\"$INSTDIR\Uninstall-codex-own.exe$\"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\codex-own" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\codex-own" "NoRepair" 1
 StrCpy $Installing 0
SectionEnd
Section "Uninstall"
 SetShellVarContext current
 StrCpy $INSTDIR "$LOCALAPPDATA\Programs\codex-own"
 StrCpy $0 "$INSTDIR\current\resources\own-updater\node.exe"
 IfFileExists "$0" +2 0
 StrCpy $0 "$INSTDIR\current\resources\cua_node\bin\node.exe"
 nsExec::ExecToStack '"$0" "$INSTDIR\installer-support-${VERSION}\uninstall-check.cjs"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  MessageBox MB_ICONSTOP "请完全退出 codex-own 后重试；未知安装保持不变。"
  Abort
 ${EndIf}
 RMDir /r "$INSTDIR\current"
 Delete "$SMPROGRAMS\codex-own\codex-own.lnk"
 RMDir "$SMPROGRAMS\codex-own"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\codex-own"
 Delete "$INSTDIR\Uninstall-codex-own.exe"
 DetailPrint "应用程序已卸载；配置、密钥、对话和恢复备份均保留在独立数据目录。"
SectionEnd
