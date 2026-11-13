param([ValidateSet('encrypt','decrypt')][string]$Mode, [string]$Service)
$ErrorActionPreference = 'Stop'
try {
    if (-not $Service.StartsWith('codex-own.credentials.') -or $Service.Length -gt 160) { throw 'Invalid service' }
    Add-Type -AssemblyName System.Security
    $data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
    if ($data.Length -gt 2097152) { throw 'Invalid size' }
    $entropy = [Text.Encoding]::UTF8.GetBytes($Service)
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($Mode -eq 'encrypt') {
        $result = [Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope)
    } else {
        $result = [Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, $scope)
    }
    [Console]::Out.Write([Convert]::ToBase64String($result))
} catch {
    [Console]::Error.WriteLine('OS_CREDENTIAL_STORE_UNAVAILABLE')
    exit 1
}
