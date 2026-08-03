Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-TelemetryProjectRoot {
  return (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

function Get-TelemetryPaths {
  param([string]$ProjectRoot = (Get-TelemetryProjectRoot))
  $telemetryRoot = Join-Path $ProjectRoot 'logs\telemetry'
  [pscustomobject]@{
    ProjectRoot = $ProjectRoot
    Config = Join-Path $ProjectRoot 'config\telemetry\otel-collector.yaml'
    ToolRoot = Join-Path $ProjectRoot 'tools\otelcol'
    CollectorExe = Join-Path $ProjectRoot 'tools\otelcol\otelcol-contrib.exe'
    Raw = Join-Path $telemetryRoot 'raw'
    Normalized = Join-Path $telemetryRoot 'normalized\model-budget-events.jsonl'
    State = Join-Path $telemetryRoot 'state\aggregator-state.json'
    CollectorLog = Join-Path $telemetryRoot 'collector\collector.log'
    PidFile = Join-Path $telemetryRoot 'collector\collector.pid'
    BudgetLog = Join-Path $ProjectRoot 'logs\MODEL_BUDGET_LOG.md'
    CodexConfig = Join-Path $HOME '.codex\config.toml'
  }
}

function Initialize-TelemetryDirectories {
  param([string]$ProjectRoot = (Get-TelemetryProjectRoot))
  $p = Get-TelemetryPaths -ProjectRoot $ProjectRoot
  @($p.Raw, (Split-Path $p.Normalized), (Split-Path $p.State), (Split-Path $p.CollectorLog), $p.ToolRoot) |
    ForEach-Object { New-Item -ItemType Directory -Path $_ -Force | Out-Null }
  return $p
}

function Write-AtomicUtf8 {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Content)
  $dir = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $tmp = "$Path.tmp-$PID"
  [IO.File]::WriteAllText($tmp, $Content, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Get-CollectorProcess {
  param([Parameter(Mandatory)]$Paths)
  if (-not (Test-Path $Paths.PidFile)) { return $null }
  $pidValue = (Get-Content -LiteralPath $Paths.PidFile -Raw).Trim()
  if ($pidValue -notmatch '^\d+$') { return $null }
  $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  if ($process.ProcessName -notlike 'otelcol*') { return $null }
  return $process
}

Export-ModuleMember -Function Get-TelemetryProjectRoot,Get-TelemetryPaths,Initialize-TelemetryDirectories,Write-AtomicUtf8,Get-CollectorProcess
