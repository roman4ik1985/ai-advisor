param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8788,
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$')]
  [string]$InstanceName = 'AI Advisor',
  [string]$SecretStorePath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apiTaskName = "$InstanceName API Host"
$monitorTaskName = "$InstanceName Health Monitor"
$powershellPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$logDirectory = Join-Path $projectRoot 'logs'
$installLog = Join-Path $logDirectory 'install-local-host-tasks.log'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

trap {
  Add-Content -LiteralPath $installLog -Encoding utf8 -Value (
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') error: $($_.Exception.Message)"
  )
  throw
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this installer from an elevated PowerShell session.'
}

$backupDirectory = Join-Path $projectRoot (
  'backups\task-scheduler-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
)
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

foreach ($taskName in @($apiTaskName, $monitorTaskName)) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Export-ScheduledTask -TaskName $taskName |
      Set-Content -LiteralPath (Join-Path $backupDirectory "$taskName.xml") -Encoding utf8
  }
}

$systemPrincipal = New-ScheduledTaskPrincipal `
  -UserId 'SYSTEM' `
  -LogonType ServiceAccount `
  -RunLevel Highest

$apiTaskArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\run-api-task.ps1`" -Port $Port"
if (-not [string]::IsNullOrWhiteSpace($SecretStorePath)) {
  $apiTaskArguments += " -SecretStorePath `"$([IO.Path]::GetFullPath($SecretStorePath))`""
}
$apiAction = New-ScheduledTaskAction `
  -Execute $powershellPath `
  -Argument $apiTaskArguments `
  -WorkingDirectory $projectRoot
$apiTrigger = New-ScheduledTaskTrigger -AtStartup
$apiSettings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $apiTaskName `
  -Action $apiAction `
  -Trigger $apiTrigger `
  -Principal $systemPrincipal `
  -Settings $apiSettings `
  -Description 'Runs the AI Advisor API before user logon and restarts it after failure.' `
  -Force | Out-Null

$monitorAction = New-ScheduledTaskAction `
  -Execute $powershellPath `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\monitor-local-host.ps1`" -Port $Port" `
  -WorkingDirectory $projectRoot
$monitorTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1)
$monitorSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

Register-ScheduledTask `
  -TaskName $monitorTaskName `
  -Action $monitorAction `
  -Trigger $monitorTrigger `
  -Principal $systemPrincipal `
  -Settings $monitorSettings `
  -Description 'Checks AI Advisor every minute, self-heals the API and queues deduplicated Telegram alerts.' `
  -Force | Out-Null

Add-Content -LiteralPath $installLog -Encoding utf8 -Value (
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') installed SYSTEM tasks; backup: $backupDirectory"
)

[pscustomobject]@{
  ApiTask = $apiTaskName
  MonitorTask = $monitorTaskName
  SecretStorePath = $SecretStorePath
  RunAs = 'SYSTEM'
  BackupDirectory = $backupDirectory
}
