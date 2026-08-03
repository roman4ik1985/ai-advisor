[CmdletBinding()]
param([string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Telemetry.Common.psm1') -Force
$p = Get-TelemetryPaths -ProjectRoot $ProjectRoot
$process = Get-CollectorProcess -Paths $p
$port = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$raw = @('codex-logs.jsonl','codex-traces.jsonl','codex-metrics.jsonl') | ForEach-Object {
  $path = Join-Path $p.Raw $_
  [pscustomobject]@{ Name=$_; Exists=(Test-Path $path); Bytes=if(Test-Path $path){(Get-Item $path).Length}else{0}; LastWriteUtc=if(Test-Path $path){(Get-Item $path).LastWriteTimeUtc}else{$null} }
}
$codexSafe = $false
if (Test-Path $p.CodexConfig) {
  $text = Get-Content -LiteralPath $p.CodexConfig -Raw
  $codexSafe = ($text -match '(?m)^log_user_prompt\s*=\s*false\s*$') -and ($text -match '127\.0\.0\.1:4318/v1/logs') -and ($text -match '127\.0\.0\.1:4318/v1/traces') -and ($text -match '127\.0\.0\.1:4318/v1/metrics')
}
[pscustomobject]@{
  CollectorStatus = if($process){'running'}else{'stopped'}
  Pid = if($process){$process.Id}else{$null}
  ListenerPid = if($port){$port.OwningProcess}else{$null}
  LoopbackEndpoint = [bool]$port
  CodexOtelConfigSafe = $codexSafe
  Config = $p.Config
  RawSignals = $raw
  NormalizedExists = Test-Path $p.Normalized
  BudgetLogExists = Test-Path $p.BudgetLog
  FormalAcceptance = 'NOT_RUN'
}
