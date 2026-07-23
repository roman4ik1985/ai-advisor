param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8788,
  [switch]$RestartApi,
  [switch]$NoThrow,
  [string]$PublicHealthUrl = 'https://ai.ledprojector.com.ua/health'
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$healthUrl = "http://127.0.0.1:$Port/health"

function Test-AdvisorHealth {
  param([Parameter(Mandatory)][string]$Url)

  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 $Url
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

$apiHealthy = Test-AdvisorHealth -Url $healthUrl
$apiInitiallyHealthy = $apiHealthy
$apiRestartAttempted = $false
if (-not $apiHealthy -and $RestartApi) {
  $apiRestartAttempted = $true
  $apiTaskName = 'AI Advisor API Host'
  $apiTask = Get-ScheduledTask -TaskName $apiTaskName -ErrorAction SilentlyContinue
  if ($apiTask) {
    if ($apiTask.State -eq 'Running') {
      Stop-ScheduledTask -TaskName $apiTaskName
      Start-Sleep -Seconds 1
    }
    Start-ScheduledTask -TaskName $apiTaskName
  } else {
    & (Join-Path $PSScriptRoot 'start-api-background.ps1') -Port $Port
  }

  for ($attempt = 0; $attempt -lt 30 -and -not $apiHealthy; $attempt += 1) {
    Start-Sleep -Seconds 1
    $apiHealthy = Test-AdvisorHealth -Url $healthUrl
  }
  $apiHealthy = Test-AdvisorHealth -Url $healthUrl
}

$cloudflaredService = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction SilentlyContinue
$tunnelRunning = $cloudflaredService -and $cloudflaredService.State -eq 'Running'
$publicHealthy = if ($tunnelRunning) {
  Test-AdvisorHealth -Url $PublicHealthUrl
} else {
  $false
}

[pscustomobject]@{
  ProjectRoot = $projectRoot
  ApiInitiallyHealthy = $apiInitiallyHealthy
  ApiRestartAttempted = $apiRestartAttempted
  ApiHealthy = $apiHealthy
  CloudflaredServiceStatus = if ($cloudflaredService) { $cloudflaredService.State } else { 'NotInstalled' }
  TunnelMode = if ($cloudflaredService) { 'named-tunnel-service' } else { 'not-detected' }
  PublicHealthUrl = $PublicHealthUrl
  PublicHealthy = $publicHealthy
}

if (-not $apiHealthy -and -not $NoThrow) {
  throw "AI Advisor API is unavailable at $healthUrl."
}

if (-not $tunnelRunning -and -not $NoThrow) {
  throw 'The Cloudflared named-tunnel Windows service is not running.'
}

if (-not $publicHealthy -and -not $NoThrow) {
  throw "AI Advisor public endpoint is unavailable at $PublicHealthUrl."
}
