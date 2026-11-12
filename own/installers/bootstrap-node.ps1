param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $root = [IO.Path]::GetFullPath($Payload)
  $info = Get-Content -LiteralPath (Join-Path $root 'installer.json') -Raw | ConvertFrom-Json
  if ($info.schema -ne 2 -or $info.platform -ne 'win32-x64' -or $info.bootstrap.nodeEntry -notmatch '^node-v[0-9.]+-win-x64/node\.exe$') { throw 'Invalid bootstrap contract' }
  $archive = Join-Path $root 'node.zip'
  $expected = @($info.files | Where-Object { $_.path -eq 'node.zip' })
  $node = @($info.files | Where-Object { $_.path -eq 'engine/node.exe' })
  if ($expected.Count -ne 1 -or $node.Count -ne 1) { throw 'Missing bootstrap identity' }
  if ((Get-Item -LiteralPath $archive).Length -ne $expected[0].size -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected[0].sha256) { throw 'Node archive checksum mismatch' }
  $destination = Join-Path $root 'bootstrap-node'
  if (Test-Path -LiteralPath $destination) { throw 'Bootstrap directory exists' }
  Expand-Archive -LiteralPath $archive -DestinationPath $destination
  $source = Join-Path $destination $info.bootstrap.nodeEntry
  if ((Get-Item -LiteralPath $source).Length -ne $node[0].size -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $node[0].sha256) { throw 'Node executable checksum mismatch' }
  $target = Join-Path $root 'engine/node.exe'
  if (Test-Path -LiteralPath $target) { throw 'Bootstrap executable exists' }
  [IO.File]::Copy($source, $target, $false)
  Write-Output 'Verified installer Node prepared'
} catch { Write-Error $_; exit 5 }
