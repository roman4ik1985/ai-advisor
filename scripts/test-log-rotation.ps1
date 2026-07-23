$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $projectRoot ("logs\\test-log-rotation-" + [guid]::NewGuid().ToString('N'))
$testArchive = Join-Path $testRoot 'archive'

try {
  New-Item -ItemType Directory -Path $testArchive -Force | Out-Null
  $activeLog = Join-Path $testRoot 'ai-advisor-api.out.log'
  Set-Content -LiteralPath $activeLog -Encoding utf8 -Value ('x' * 2048)
  $staleArchive = Join-Path $testArchive 'ai-advisor-api.err.log.20000101-000000'
  Set-Content -LiteralPath $staleArchive -Encoding utf8 -Value 'stale'
  (Get-Item -LiteralPath $staleArchive).LastWriteTime = (Get-Date).AddDays(-15)
  $result = & (Join-Path $PSScriptRoot 'rotate-runtime-logs.ps1') -LogDirectory $testRoot -MaxBytes 1024 -RetentionDays 14
  $freshArchives = @(Get-ChildItem -LiteralPath $testArchive -File -Filter 'ai-advisor-api.out.log.*')
  if ($result.rotated.Count -ne 1 -or $freshArchives.Count -ne 1) { throw 'Expected exactly one rotated test log.' }
  if ((Get-Item -LiteralPath $activeLog).Length -ne 0) { throw 'Expected the active test log to be empty after rotation.' }
  if (Test-Path -LiteralPath $staleArchive) { throw 'Expected the stale test archive to be removed.' }
  Write-Output 'Log rotation smoke passed.'
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
    if ($resolvedTestRoot -like (Join-Path $projectRoot 'logs\\test-log-rotation-*')) {
      Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
  }
}
