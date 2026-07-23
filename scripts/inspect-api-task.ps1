param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8788
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = 'AI Advisor API Host'
$resultPath = Join-Path $projectRoot 'logs\inspect-api-task.json'

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

$result = [ordered]@{
  inspectedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  taskName = $taskName
  state = $task.State.ToString()
  runAs = $task.Principal.UserId
  logonType = $task.Principal.LogonType.ToString()
  lastRunTime = $info.LastRunTime
  lastTaskResult = $info.LastTaskResult
  nextRunTime = $info.NextRunTime
  restartCount = $task.Settings.RestartCount
  restartInterval = $task.Settings.RestartInterval
  executionTimeLimit = $task.Settings.ExecutionTimeLimit
  stopIfGoingOnBatteries = $task.Settings.StopIfGoingOnBatteries
  listenerPid = if ($listener) { $listener.OwningProcess } else { $null }
}
$result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8
$result
