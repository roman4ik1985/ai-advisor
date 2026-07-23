param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8788
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = 'AI Advisor Health Monitor'
$powershellPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this installer from an elevated PowerShell session.'
}

$backupDirectory = Join-Path $projectRoot (
  'backups\task-scheduler-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
)
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Export-ScheduledTask -TaskName $taskName |
    Set-Content -LiteralPath (Join-Path $backupDirectory "$taskName.xml") -Encoding utf8
}

$systemPrincipal = New-ScheduledTaskPrincipal `
  -UserId 'SYSTEM' `
  -LogonType ServiceAccount `
  -RunLevel Highest
$action = New-ScheduledTaskAction `
  -Execute $powershellPath `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\monitor-local-host.ps1`" -Port $Port" `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $systemPrincipal `
  -Settings $settings `
  -Description 'Checks AI Advisor every minute, self-heals the API and queues deduplicated Telegram alerts.' `
  -Force | Out-Null

$result = [ordered]@{
  installedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  taskName = $taskName
  runAs = 'SYSTEM'
  interval = 'PT1M'
  backupDirectory = $backupDirectory
}
$resultPath = Join-Path $projectRoot 'logs\install-monitor-task.json'
$result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8
$result
