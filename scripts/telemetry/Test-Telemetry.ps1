[CmdletBinding()]
param(
  [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$OutputDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Telemetry.Common.psm1') -Force
$p = Get-TelemetryPaths -ProjectRoot $ProjectRoot
if(-not $OutputDirectory){$OutputDirectory=Join-Path $ProjectRoot 'logs\telemetry\test-results'}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$results=[Collections.Generic.List[object]]::new()
function Add-Result([string]$Id,[string]$Name,[bool]$Passed,[string]$Expected,[string]$Actual){
  $results.Add([pscustomobject]@{test_id=$Id;name=$Name;status=if($Passed){'passed'}else{'failed'};expected=$Expected;actual=$Actual;evidence=@();error=$null})
}
Add-Result 'DEV-001' 'Collector config exists' (Test-Path $p.Config) 'file exists' $p.Config
Add-Result 'DEV-002' 'Collector executable exists' (Test-Path $p.CollectorExe) 'file exists' $p.CollectorExe
$cfg=if(Test-Path $p.Config){Get-Content $p.Config -Raw}else{''}
Add-Result 'DEV-003' 'Loopback-only OTLP receiver' ($cfg -match 'endpoint:\s*127\.0\.0\.1:4318' -and $cfg -notmatch '0\.0\.0\.0:4318') '127.0.0.1:4318 only' 'configuration scan'
Add-Result 'DEV-004' 'Three signal pipelines' (($cfg -match '(?m)^\s{4}logs:') -and ($cfg -match '(?m)^\s{4}traces:') -and ($cfg -match '(?m)^\s{4}metrics:')) 'logs,traces,metrics' 'configuration scan'
$codex=if(Test-Path $p.CodexConfig){Get-Content $p.CodexConfig -Raw}else{''}
Add-Result 'DEV-005' 'Prompt logging disabled' ($codex -match '(?m)^log_user_prompt\s*=\s*false\s*$') 'false' 'redacted configuration scan'
Add-Result 'DEV-006' 'Local exporters configured' (($codex -match '127\.0\.0\.1:4318/v1/logs') -and ($codex -match '127\.0\.0\.1:4318/v1/traces') -and ($codex -match '127\.0\.0\.1:4318/v1/metrics')) 'all local endpoints' 'redacted configuration scan'
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$jsonPath=Join-Path $OutputDirectory "developer-self-check-$stamp.json"
$mdPath=Join-Path $OutputDirectory "developer-self-check-$stamp.md"
$payload=[ordered]@{run_id=$stamp;kind='developer_self_check';formal_acceptance='NOT_RUN';results=$results} | ConvertTo-Json -Depth 10
Write-AtomicUtf8 $jsonPath $payload
$md=@('# Developer telemetry self-check','',"Run: $stamp",'','This is not independent acceptance testing.','', '| Test | Status |','|---|---|')
foreach($r in $results){$md += "| $($r.test_id) $($r.name) | $($r.status) |"}
Write-AtomicUtf8 $mdPath (($md-join "`r`n")+"`r`n")
$failed=@($results|Where-Object status -eq 'failed').Count
[pscustomobject]@{Passed=$results.Count-$failed;Failed=$failed;Json=$jsonPath;Markdown=$mdPath;FormalAcceptance='NOT_RUN'}
if($failed){exit 1}
