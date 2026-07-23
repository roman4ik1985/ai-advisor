param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8788,
  [ValidateRange(30, 240)]
  [int]$TimeoutSeconds = 150
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apiTaskName = 'AI Advisor API Host'
$localHealthUrl = "http://127.0.0.1:$Port/health"
$publicHealthUrl = 'https://ai.ledprojector.com.ua/health'
$resultPath = Join-Path $projectRoot 'logs\test-api-task-recovery.json'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this recovery test from an elevated PowerShell session.'
}

$task = Get-ScheduledTask -TaskName $apiTaskName -ErrorAction Stop
if ($task.State -ne 'Running') {
  throw "$apiTaskName is not running before the recovery test."
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
  Select-Object -First 1
$oldPid = $listener.OwningProcess
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$oldPid"
if (
  $process.Name -ne 'node.exe' -or
  $process.CommandLine -notmatch 'server\.mjs\s+--provider=api'
) {
  throw "Port $Port belongs to an unexpected process (PID $oldPid)."
}

Stop-Process -Id $oldPid -Force
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$newPid = $null

while ((Get-Date) -lt $deadline -and -not $newPid) {
  Start-Sleep -Seconds 2
  $candidate = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($candidate -and $candidate.OwningProcess -ne $oldPid) {
    $newPid = $candidate.OwningProcess
  }
}

if (-not $newPid) {
  Start-ScheduledTask -TaskName $apiTaskName
  throw "Automatic recovery did not restore port $Port within $TimeoutSeconds seconds."
}

$localResponse = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri $localHealthUrl
$publicResponse = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri $publicHealthUrl
$taskInfo = Get-ScheduledTaskInfo -TaskName $apiTaskName

$result = [ordered]@{
  testedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  taskName = $apiTaskName
  oldProcessId = $oldPid
  newProcessId = $newPid
  recoveredAutomatically = $oldPid -ne $newPid
  localStatus = $localResponse.StatusCode
  publicStatus = $publicResponse.StatusCode
  taskState = (Get-ScheduledTask -TaskName $apiTaskName).State.ToString()
  lastTaskResult = $taskInfo.LastTaskResult
}
$result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8
$result
