param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8788,
  [string]$StatePath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$warningLog = Join-Path $logDirectory 'ai-advisor-monitor.warn.log'
$eventLog = Join-Path $logDirectory 'ai-advisor-monitor.events.log'
if (-not $StatePath) {
  $StatePath = Join-Path $logDirectory 'ai-advisor-monitor-state.json'
}

function Write-MonitorWarning {
  param([Parameter(Mandatory)][string]$Message)
  Add-Content -LiteralPath $warningLog -Encoding utf8 -Value (
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  )
}

function Read-MonitorState {
  if (-not (Test-Path -LiteralPath $StatePath)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  } catch {
    Write-MonitorWarning -Message "state-read-error: $($_.Exception.Message)"
    return $null
  }
}

function Save-MonitorState {
  param([Parameter(Mandatory)]$State)
  $temporaryPath = "$StatePath.tmp"
  $State | ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $temporaryPath -Encoding utf8
  Move-Item -LiteralPath $temporaryPath -Destination $StatePath -Force
}

try {
  & (Join-Path $PSScriptRoot 'rotate-runtime-logs.ps1') -LogDirectory $logDirectory | Out-Null
} catch {
  Write-MonitorWarning -Message "log-rotation-error: $($_.Exception.Message)"
}

$now = Get-Date
$previousState = Read-MonitorState
$result = & (Join-Path $PSScriptRoot 'check-local-host.ps1') `
  -Port $Port `
  -RestartApi `
  -NoThrow
$healthy = (
  $result.ApiHealthy -and
  $result.CloudflaredServiceStatus -eq 'Running' -and
  $result.PublicHealthy
)
$status = if ($healthy) { 'healthy' } else { 'down' }
$failedComponents = @()
if (-not $result.ApiHealthy) { $failedComponents += 'local API' }
if ($result.CloudflaredServiceStatus -ne 'Running') { $failedComponents += 'Cloudflared service' }
if (-not $result.PublicHealthy) { $failedComponents += 'public endpoint' }

$currentBootTime = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o')
$eventMessage = $null
$eventType = $null

if ($result.ApiRestartAttempted -and $result.ApiHealthy) {
  $eventType = 'AUTO_RECOVERED'
  $eventMessage = 'AI Advisor RECOVERED: local API was unavailable and restarted automatically. Public health is OK.'
} elseif ($previousState -and $previousState.status -ne $status) {
  if ($status -eq 'down') {
    $eventType = 'DOWN'
    $eventMessage = "AI Advisor DOWN: $($failedComponents -join ', '). The local monitor will keep retrying."
  } else {
    $eventType = 'RECOVERED'
    $eventMessage = 'AI Advisor RECOVERED: local API, Cloudflare Tunnel and public endpoint are healthy.'
  }
} elseif (
  $previousState -and
  $previousState.bootTime -and
  $previousState.bootTime -ne $currentBootTime -and
  $healthy
) {
  $eventType = 'HOST_ONLINE'
  $eventMessage = 'AI Advisor RECOVERED: Windows host restarted and the API plus Cloudflare Tunnel are online.'
} elseif ($previousState -and $previousState.notificationPending) {
  $eventType = $previousState.pendingEventType
  $eventMessage = $previousState.pendingMessage
}

$notificationPending = $false
if ($eventMessage) {
  try {
    & (Join-Path $PSScriptRoot 'send-telegram-notification.ps1') -Message $eventMessage
    Add-Content -LiteralPath $eventLog -Encoding utf8 -Value (
      "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') queued $eventType"
    )
  } catch {
    $notificationPending = $true
    Write-MonitorWarning -Message "notification-error: $($_.Exception.Message)"
  }
}

$changedAt = if (
  $previousState -and
  $previousState.status -eq $status -and
  $previousState.changedAt
) {
  $previousState.changedAt
} else {
  $now.ToString('o')
}

$state = [ordered]@{
  checkedAt = $now.ToString('o')
  status = $status
  changedAt = $changedAt
  bootTime = $currentBootTime
  apiHealthy = [bool]$result.ApiHealthy
  tunnelRunning = $result.CloudflaredServiceStatus -eq 'Running'
  publicHealthy = [bool]$result.PublicHealthy
  notificationPending = $notificationPending
  pendingEventType = if ($notificationPending) { $eventType } else { $null }
  pendingMessage = if ($notificationPending) { $eventMessage } else { $null }
}
Save-MonitorState -State $state

if (-not $healthy) {
  $message = "health-error: $($failedComponents -join ', ')"
  Write-MonitorWarning -Message $message
  throw $message
}

$result
