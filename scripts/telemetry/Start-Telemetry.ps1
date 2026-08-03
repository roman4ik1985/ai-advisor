[CmdletBinding()]
param([string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Telemetry.Common.psm1') -Force
$p = Initialize-TelemetryDirectories -ProjectRoot $ProjectRoot
if (-not (Test-Path $p.CollectorExe)) { throw "Collector is not installed: $($p.CollectorExe)" }
if (-not (Test-Path $p.Config)) { throw "Collector config is missing: $($p.Config)" }
$existing = Get-CollectorProcess -Paths $p
if ($existing) { [pscustomobject]@{ Status='already_running'; Pid=$existing.Id }; exit 0 }
$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw "Port 127.0.0.1:4318 is already in use by PID $($listener.OwningProcess)" }
& $p.CollectorExe validate --config $p.Config
if ($LASTEXITCODE -ne 0) { throw 'Collector configuration validation failed.' }
$process = Start-Process -FilePath $p.CollectorExe -ArgumentList @('--config', $p.Config) -RedirectStandardOutput $p.CollectorLog -RedirectStandardError $p.CollectorErrorLog -PassThru -WindowStyle Hidden
Set-Content -LiteralPath $p.PidFile -Value $process.Id -Encoding ascii
$deadline = (Get-Date).AddSeconds(15)
do {
  Start-Sleep -Milliseconds 500
  if ($process.HasExited) { throw "Collector exited during startup. Inspect $($p.CollectorLog) and $($p.CollectorErrorLog)" }
  $ready = Test-NetConnection -ComputerName 127.0.0.1 -Port 4318 -InformationLevel Quiet -WarningAction SilentlyContinue
} until ($ready -or (Get-Date) -ge $deadline)
if (-not $ready) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; throw 'Collector did not open 127.0.0.1:4318.' }
[pscustomobject]@{ Status='running'; Pid=$process.Id; Endpoint='127.0.0.1:4318'; FormalAcceptance='NOT_RUN' }
