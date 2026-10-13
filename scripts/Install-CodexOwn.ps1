#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ApiKeyFile = (Join-Path $PSScriptRoot 'codex-own-api-key.txt'),
    [switch]$ConfigureOnly,
    [switch]$ValidateOnly,
    [switch]$Launch
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-OwnConfiguration([string]$Core) {
    $catalog = (Join-Path $Core 'models.json').Replace('\','/')
    return @"
model = "deepseek-v4.1-flash"
model_provider = "dashscope_deepseek"
preferred_auth_method = "apikey"
forced_login_method = "api"
cli_auth_credentials_store = "file"
model_reasoning_effort = "high"
web_search = "disabled"
model_catalog_json = "$catalog"

[model_providers.dashscope_deepseek]
name = "DeepSeek - DashScope"
base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
wire_api = "responses"
requires_openai_auth = true
"@
}
function Write-OwnNewFile([string]$Path, [string]$Text) {
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($Text)
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew)
    try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
}
function Protect-OwnDirectory([string]$Path) {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true,$false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Assert-OwnNormalPath([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing a junction or symbolic link: $Path"
        }
    }
}

if ($env:OS -ne 'Windows_NT') { throw 'Run this installer on Windows x64.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'This package targets x64. Windows ARM64 is not verified.' }
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\codex-own'
$stateRoot = Join-Path $env:LOCALAPPDATA 'codex-own-independent'
$core = Join-Path $stateRoot 'core'
$payload = Join-Path $PSScriptRoot 'app'
$catalogSource = Join-Path $PSScriptRoot 'models.json'
foreach ($p in @($installRoot,$stateRoot,$core)) { Assert-OwnNormalPath $p }
if (-not (Test-Path -LiteralPath $ApiKeyFile -PathType Leaf)) { throw "API key file missing: $ApiKeyFile" }
$key = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $ApiKeyFile).Path).Trim()
if ($key -notmatch '^sk-[A-Za-z0-9_-]+$') { throw 'Key file must contain only one DashScope API key.' }
if (-not (Test-Path -LiteralPath $catalogSource)) { throw 'models.json missing from package.' }
$catalog = [IO.File]::ReadAllText($catalogSource) | ConvertFrom-Json
if ('deepseek-v4.1-flash' -notin $catalog.models.slug) { throw 'Invalid model catalog.' }
if (-not $ConfigureOnly) {
    $manifest = Get-Content -LiteralPath (Join-Path $payload 'codex-own-build.json') -Raw | ConvertFrom-Json
    if ($manifest.identity -ne 'local.codex-own') { throw 'Incorrect application identity.' }
    $exeSource = Join-Path $payload 'codex-own.exe'
    if ((Get-FileHash -LiteralPath $exeSource -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.exeSha256) { throw 'Application checksum mismatch.' }
    $asarSource = Join-Path $payload 'resources\app.asar'
    if ((Get-FileHash -LiteralPath $asarSource -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.asarSha256) { throw 'Application resources checksum mismatch.' }
}
if ($ValidateOnly) {
    Write-Output "Validation passed. Install: $installRoot ; Data: $stateRoot"
    return
}
# Refuse to replace application files while this personal application is running.
$running = @(Get-Process -Name 'codex-own' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) { throw 'Please quit codex-own before installing or changing its configuration.' }
if ((Test-Path -LiteralPath $installRoot) -and -not (Test-Path -LiteralPath (Join-Path $installRoot '.codex-own-install'))) {
    throw 'The target directory already exists and is not marked as codex-own. Nothing was replaced.'
}
foreach ($dir in @($stateRoot,$core)) {
    if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir) }
}
Protect-OwnDirectory $core
$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$backup = Join-Path $core ('backups\' + $stamp)
[void](New-Item -ItemType Directory -Path $backup)
foreach ($name in @('config.toml','auth.json','models.json')) {
    $target = Join-Path $core $name
    Assert-OwnNormalPath $target
    if (Test-Path -LiteralPath $target) {
        Copy-Item -LiteralPath $target -Destination (Join-Path $backup $name)
        if ((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath (Join-Path $backup $name)).Hash) { throw 'Backup verification failed.' }
    }
}
$content = @{
    'config.toml' = Get-OwnConfiguration $core
    'auth.json' = (@{auth_mode='apikey';OPENAI_API_KEY=$key} | ConvertTo-Json -Compress)
    'models.json' = [IO.File]::ReadAllText($catalogSource)
}
foreach ($name in $content.Keys) {
    $target = Join-Path $core $name
    $staged = $target + '.' + $stamp + '.new'
    Write-OwnNewFile $staged $content[$name]
    Move-Item -LiteralPath $staged -Destination $target -Force
    # Reset inherited ACL on pre-existing files too.
    $acl = Get-Acl -LiteralPath $target
    $acl.SetAccessRuleProtection($false,$false)
    foreach ($rule in @($acl.Access | Where-Object { -not $_.IsInherited })) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    Set-Acl -LiteralPath $target -AclObject $acl
}
$key = $null
if (-not $ConfigureOnly) {
    if (-not (Test-Path -LiteralPath $installRoot)) {
        [void](New-Item -ItemType Directory -Path $installRoot)
        Write-OwnNewFile (Join-Path $installRoot '.codex-own-install') 'local.codex-own'
    }
    $installed = Join-Path $installRoot ($manifest.version + '-' + $stamp)
    Copy-Item -LiteralPath $payload -Destination $installed -Recurse
    $exe = Join-Path $installed 'codex-own.exe'
    $menu = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\codex-own'
    if (-not (Test-Path -LiteralPath $menu)) { [void](New-Item -ItemType Directory -Path $menu) }
    $linkPath = Join-Path $menu 'codex-own.lnk'
    if (Test-Path -LiteralPath $linkPath) { Copy-Item -LiteralPath $linkPath -Destination (Join-Path $backup 'codex-own.lnk') }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = $exe
    $link.WorkingDirectory = $installed
    $link.IconLocation = "$exe,0"
    $link.Description = 'codex-own - independent DeepSeek desktop'
    $link.Save()
    Write-Output "Installed: $exe"
    if ($Launch) { Start-Process -FilePath $exe }
}
Write-Output "Configuration saved: $core"
Write-Output "Previous configuration backup: $backup"
Write-Output 'Done. Original Codex and global environment variables were not modified.'
