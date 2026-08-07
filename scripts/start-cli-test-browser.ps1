param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8787,

  [ValidateSet('Chrome', 'Edge', 'Default')]
  [string]$Browser = 'Chrome',

  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localUrl = "http://127.0.0.1:$Port/"
$healthUrl = "http://127.0.0.1:$Port/health"
$stagingUrl = 'https://ai-staging.ledprojector.com.ua/'
$devUrl = 'https://ledprojector.com.ua/dev/'
$startedNew = $false
$process = $null

function Get-HealthyCliProcess {
  param([int]$ListenPort)

  $listener = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $listener) {
    return $null
  }

  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $healthUrl
    $health = $response.Content | ConvertFrom-Json
  } catch {
    throw "Port $ListenPort is occupied, but its service is not a healthy AI Advisor CLI host."
  }

  if ($response.StatusCode -ne 200 -or $health.provider -ne 'cli') {
    throw "Port $ListenPort is occupied by a service that is not the AI Advisor CLI host."
  }

  return Get-Process -Id $listener.OwningProcess -ErrorAction Stop
}

function Resolve-BrowserExecutable {
  param([string]$BrowserName)

  if ($BrowserName -eq 'Default') {
    return $null
  }

  $relativePath = if ($BrowserName -eq 'Chrome') {
    'Google\Chrome\Application\chrome.exe'
  } else {
    'Microsoft\Edge\Application\msedge.exe'
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles $relativePath),
    (Join-Path ${env:ProgramFiles(x86)} $relativePath),
    (Join-Path $env:LOCALAPPDATA $relativePath)
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  return $candidates | Select-Object -First 1
}

$process = Get-HealthyCliProcess -ListenPort $Port
if (-not $process) {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $logDirectory = Join-Path $projectRoot 'logs'
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $stdoutPath = Join-Path $logDirectory 'ai-advisor-cli.out.log'
  $stderrPath = Join-Path $logDirectory 'ai-advisor-cli.err.log'
  $previousPort = $env:PORT
  $env:PORT = [string]$Port

  try {
    $process = Start-Process `
      -FilePath $nodePath `
      -ArgumentList @('--env-file-if-exists=.env', 'server.mjs', '--provider=cli') `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -PassThru
    $startedNew = $true
  } finally {
    if ($null -eq $previousPort) {
      Remove-Item Env:PORT -ErrorAction SilentlyContinue
    } else {
      $env:PORT = $previousPort
    }
  }

  $healthy = $false
  for ($attempt = 0; $attempt -lt 40 -and -not $healthy; $attempt += 1) {
    if ($process.HasExited) {
      $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw $stderrPath } else { '' }
      throw "CLI process exited during startup: $stderr"
    }

    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $healthUrl
      $health = $response.Content | ConvertFrom-Json
      $healthy = $response.StatusCode -eq 200 -and $health.provider -eq 'cli'
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }

  if (-not $healthy) {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
    }
    throw "CLI process did not become healthy at $healthUrl."
  }
}

try {
  $stagingResponse = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri $stagingUrl
  if ($stagingResponse.StatusCode -ne 200) {
    throw "Staging returned HTTP $($stagingResponse.StatusCode)."
  }
} catch {
  throw "Public staging is unavailable at $stagingUrl $($_.Exception.Message)"
}

if (-not $NoBrowser) {
  $urls = @($localUrl, $stagingUrl, $devUrl)
  $browserPath = Resolve-BrowserExecutable -BrowserName $Browser
  if ($browserPath) {
    Start-Process -FilePath $browserPath -ArgumentList $urls | Out-Null
  } elseif ($Browser -eq 'Default') {
    foreach ($url in $urls) {
      Start-Process $url | Out-Null
    }
  } else {
    throw "$Browser was not found. Use -Browser Edge or -Browser Default."
  }
}

[pscustomobject]@{
  ProcessId = $process.Id
  StartedNew = $startedNew
  LocalHealthy = $true
  StagingHealthy = $true
  LocalUrl = $localUrl
  StagingUrl = $stagingUrl
  DevUrl = $devUrl
  Browser = if ($NoBrowser) { 'NotOpened' } else { $Browser }
  ProductionTouched = $false
}
