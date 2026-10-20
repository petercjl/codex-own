Unicode true
RequestExecutionLevel user
SetCompressor /FINAL zlib
SetCompress off
Name "codex-own ${VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\codex-own"
ShowInstDetails show
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
Var KeyFile
Var KeyInput
Var Parameters
Var Installing
!define MUI_WELCOMEPAGE_TEXT "安装 codex-own ${VERSION}，包含完整桌面应用与独立 Node、npm、Python。$\r$\n$\r$\n安装无需预装开发工具；请预留至少 10 GB 可用空间，并先完全退出 codex-own。$\r$\n$\r$\n安装后可从开始菜单打开，后续在应用内更新。已有配置与对话会保留。"
!insertmacro MUI_PAGE_WELCOME
Page custom ApiPage ApiLeave
!define MUI_PAGE_CUSTOMFUNCTION_PRE DisableCancel
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "codex-own 已安装。请在开始菜单中打开 codex-own。$\r$\n$\r$\n后续请使用应用内的“更新”菜单。若未导入 API 配置，可退出应用后重新运行本安装器选择配置文件。$\r$\n$\r$\n安装包文件在安装成功后可自行删除。"
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
FunctionEnd
Function DisableCancel
 GetDlgItem $0 $HWNDPARENT 2
 EnableWindow $0 0
FunctionEnd
Function .onUserAbort
 ${If} $Installing == 1
  Abort
 ${EndIf}
FunctionEnd
Function ApiPage
 !insertmacro MUI_HEADER_TEXT "API 配置文件（可选）" "请选择你保存的 API 密钥 txt 文件；它只会写入本机独立配置目录。"
 nsDialogs::Create 1018
 Pop $0
 ${If} $0 == error
  Abort
 ${EndIf}
 ${NSD_CreateLabel} 0 0 100% 48u "文件路径因下载位置而不同，请选择自己的文件。$\r$\n已有配置无需再次导入；文件内容和密钥不会上传到更新服务。"
 Pop $0
 ${NSD_CreateText} 0 58u 78% 14u "$KeyFile"
 Pop $KeyInput
 ${NSD_CreateButton} 80% 57u 20% 16u "选择文件…"
 Pop $0
 ${NSD_OnClick} $0 PickKey
 nsDialogs::Show
FunctionEnd
Function PickKey
 nsDialogs::SelectFileDialog open "" "文本文件 (*.txt)|*.txt|所有文件 (*.*)|*.*"
 Pop $0
 ${If} $0 != ""
  ${NSD_SetText} $KeyInput $0
 ${EndIf}
FunctionEnd
Function ApiLeave
 ${NSD_GetText} $KeyInput $KeyFile
FunctionEnd

Section "安装 codex-own"
 StrCpy $Installing 1
 InitPluginsDir
 SetOutPath "$PLUGINSDIR\payload"
 File /r "${PAYLOAD}\*"
 DetailPrint "正在校验并安装完整资源，请耐心等待…"
 ${If} $KeyFile == ""
  nsExec::ExecToStack '"$PLUGINSDIR\payload\engine\node.exe" "$PLUGINSDIR\payload\offline-install.mjs"'
 ${Else}
  nsExec::ExecToStack '"$PLUGINSDIR\payload\engine\node.exe" "$PLUGINSDIR\payload\offline-install.mjs" --api-key-file "$KeyFile"'
 ${EndIf}
 Pop $0
 Pop $1
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
 nsExec::ExecToStack '"$INSTDIR\current\resources\own-updater\node.exe" "$INSTDIR\installer-support-${VERSION}\uninstall-check.cjs"'
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
