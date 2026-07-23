param(
  [string]$LogDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'logs'),
  [ValidateRange(1024, 1073741824)]
  [int64]$MaxBytes = 10MB,
  [ValidateRange(1, 3650)]
  [int]$RetentionDays = 14
)

$ErrorActionPreference = 'Stop'
$managedLogNames = @(
  'ai-advisor-api.out.log',
  'ai-advisor-api.err.log',
  'ai-advisor-api-task.log',
  'ai-advisor-monitor.warn.log',
  'ai-advisor-monitor.events.log',
  'ai-advisor-learning.log'
)

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$archiveDirectory = Join-Path $LogDirectory 'archive'
New-Item -ItemType Directory -Path $archiveDirectory -Force | Out-Null
$rotated = @()

foreach ($logName in $managedLogNames) {
  $logPath = Join-Path $LogDirectory $logName
  if (-not (Test-Path -LiteralPath $logPath)) { continue }
  $logFile = Get-Item -LiteralPath $logPath
  if ($logFile.Length -lt $MaxBytes) { continue }

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $archivePath = Join-Path $archiveDirectory "$logName.$timestamp"
  Copy-Item -LiteralPath $logPath -Destination $archivePath -ErrorAction Stop
  Clear-Content -LiteralPath $logPath -ErrorAction Stop
  $rotated += [pscustomobject]@{ log = $logName; archive = $archivePath; bytes = $logFile.Length }
}

$cutoff = (Get-Date).AddDays(-$RetentionDays)
$deleted = @(
  Get-ChildItem -LiteralPath $archiveDirectory -File |
    Where-Object { $_.Name -like 'ai-advisor-*.log.*' -and $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
      $path = $_.FullName
      Remove-Item -LiteralPath $path -Force -ErrorAction Stop
      $path
    }
)

[pscustomobject]@{ rotated = $rotated; deleted = $deleted; archiveDirectory = $archiveDirectory }
