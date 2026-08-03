[CmdletBinding(SupportsShouldProcess)]
param([string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Telemetry.Common.psm1') -Force
$p = Get-TelemetryPaths -ProjectRoot $ProjectRoot
$process = Get-CollectorProcess -Paths $p
if (-not $process) {
  Remove-Item -LiteralPath $p.PidFile -Force -ErrorAction SilentlyContinue
  [pscustomobject]@{ Status='not_running' }
  exit 0
}
if ($PSCmdlet.ShouldProcess("PID $($process.Id)", 'Stop OpenTelemetry Collector')) {
  Stop-Process -Id $process.Id
  try { Wait-Process -Id $process.Id -Timeout 15 -ErrorAction Stop }
  catch { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $p.PidFile -Force -ErrorAction SilentlyContinue
}
[pscustomobject]@{ Status='stopped'; Pid=$process.Id }
