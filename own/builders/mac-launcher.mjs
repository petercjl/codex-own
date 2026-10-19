export function launcherScript(development=false){
 const home='own_account_home="$(/usr/bin/dscl /Search -read "/Users/$(/usr/bin/id -un)" NFSHomeDirectory)"\nown_account_home="${own_account_home#NFSHomeDirectory: }"\ncase "$own_account_home" in /*) ;; *) exit 1 ;; esac\nexport HOME="$own_account_home"\nexport CFFIXED_USER_HOME="$HOME"\nexport USERPROFILE="$HOME"\n';
 return '#!/bin/sh\nset -eu\n'+home+'own_root="$own_account_home'+(development?'/.codex-own-dev':'')+'/Library/Application Support/codex-own-independent"\nmkdir -p "$own_root/desktop" "$own_root/core" "$own_root/tmp"\nexec "$(dirname "$0")/ChatGPT" --user-data-dir="$own_root/desktop" "$@"\n';
}
