param(
  [ValidateRange(30, 120)]
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = 'AI Advisor Health Monitor'
$serviceName = 'Cloudflared'
$publicHealthUrl = 'https://ai.ledprojector.com.ua/health'
$resultPath = Join-Path $projectRoot 'logs\test-monitor-notifications.json'
$eventLog = Join-Path $projectRoot 'logs\ai-advisor-monitor.events.log'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this notification smoke from an elevated PowerShell session.'
}

function Wait-TaskRun {
  param([Parameter(Mandatory)][datetime]$PreviousRun)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $task = Get-ScheduledTask -TaskName $taskName
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    if ($info.LastRunTime -gt $PreviousRun -and $task.State -eq 'Ready') {
      return $info
    }
    Start-Sleep -Seconds 1
  }
  throw "$taskName did not complete within $TimeoutSeconds seconds."
}

function Invoke-MonitorTask {
  $before = Get-ScheduledTaskInfo -TaskName $taskName
  Start-ScheduledTask -TaskName $taskName
  Wait-TaskRun -PreviousRun $before.LastRunTime
}

$service = Get-Service -Name $serviceName
if ($service.Status -ne 'Running') {
  throw "$serviceName must be running before the notification smoke."
}

$downInfo = $null
$recoveredInfo = $null
try {
  Stop-Service -Name $serviceName -Force
  (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
  $downInfo = Invoke-MonitorTask
} finally {
  Start-Service -Name $serviceName
  (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
}

$publicHealthy = $false
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline -and -not $publicHealthy) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $publicHealthUrl
    $publicHealthy = $response.StatusCode -eq 200
  } catch {
    $publicHealthy = $false
  }
  if (-not $publicHealthy) {
    Start-Sleep -Seconds 2
  }
}
if (-not $publicHealthy) {
  throw "Public health did not recover within $TimeoutSeconds seconds."
}

$recoveredInfo = Invoke-MonitorTask
$recentEvents = @(Get-Content -LiteralPath $eventLog -Tail 10)
$downQueued = [bool]($recentEvents -match 'queued DOWN')
$recoveredQueued = [bool]($recentEvents -match 'queued RECOVERED')

$result = [ordered]@{
  testedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  cloudflaredRunning = (Get-Service -Name $serviceName).Status -eq 'Running'
  publicHealthy = $publicHealthy
  downTaskResult = $downInfo.LastTaskResult
  recoveredTaskResult = $recoveredInfo.LastTaskResult
  downQueued = $downQueued
  recoveredQueued = $recoveredQueued
}
$result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8
$result

if (-not $downQueued -or -not $recoveredQueued) {
  throw 'DOWN and RECOVERED events were not both queued.'
}
