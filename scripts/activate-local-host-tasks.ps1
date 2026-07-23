param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8788
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apiTaskName = 'AI Advisor API Host'
$healthUrl = "http://127.0.0.1:$Port/health"
$logDirectory = Join-Path $projectRoot 'logs'
$resultPath = Join-Path $logDirectory 'activate-local-host-tasks.json'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this activation script from an elevated PowerShell session.'
}

$apiTask = Get-ScheduledTask -TaskName $apiTaskName -ErrorAction Stop
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($listener) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if (
    $process.Name -ne 'node.exe' -or
    $process.CommandLine -notmatch 'server\.mjs\s+--provider=api'
  ) {
    throw "Port $Port belongs to an unexpected process (PID $($listener.OwningProcess))."
  }

  Stop-Process -Id $listener.OwningProcess -Force
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
      break
    }
    Start-Sleep -Milliseconds 250
  }
}

try {
  Start-ScheduledTask -TaskName $apiTaskName
  $healthy = $false
  for ($attempt = 0; $attempt -lt 40 -and -not $healthy; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $healthUrl
      $healthy = $response.StatusCode -eq 200
    } catch {
      $healthy = $false
    }
  }

  if (-not $healthy) {
    throw "SYSTEM-hosted API did not become healthy at $healthUrl."
  }
} catch {
  if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    & (Join-Path $PSScriptRoot 'start-api-background.ps1') -Port $Port | Out-Null
  }
  throw
}

$startupCmd = Join-Path ([Environment]::GetFolderPath('Startup')) 'AI Advisor API.cmd'
$disabledStartupCmd = "$startupCmd.disabled"
if ((Test-Path -LiteralPath $startupCmd) -and -not (Test-Path -LiteralPath $disabledStartupCmd)) {
  Move-Item -LiteralPath $startupCmd -Destination $disabledStartupCmd
}

$taskInfo = Get-ScheduledTaskInfo -TaskName $apiTaskName
$activeListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
  Select-Object -First 1
$activeProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($activeListener.OwningProcess)"

$result = [ordered]@{
  activatedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  taskName = $apiTaskName
  runAs = $apiTask.Principal.UserId
  taskState = (Get-ScheduledTask -TaskName $apiTaskName).State.ToString()
  lastTaskResult = $taskInfo.LastTaskResult
  processId = $activeProcess.ProcessId
  processCommandLine = $activeProcess.CommandLine
  localHealthy = $true
  startupLauncherDisabled = Test-Path -LiteralPath $disabledStartupCmd
}
$result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8
$result
