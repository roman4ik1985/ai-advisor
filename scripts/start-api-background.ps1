param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8788
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existingListener) {
  throw "Port $Port is already in use by PID $($existingListener.OwningProcess)."
}

$logDirectory = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stdoutPath = Join-Path $logDirectory 'ai-advisor-api.out.log'
$stderrPath = Join-Path $logDirectory 'ai-advisor-api.err.log'
$previousPort = $env:PORT
$env:PORT = [string]$Port

try {
  $process = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @('--env-file-if-exists=.env', 'server.mjs', '--provider=api') `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
} finally {
  if ($null -eq $previousPort) {
    Remove-Item Env:PORT -ErrorAction SilentlyContinue
  } else {
    $env:PORT = $previousPort
  }
}

$healthUrl = "http://127.0.0.1:$Port/health"
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  if ($process.HasExited) {
    $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
    throw "API process exited during startup: $stderr"
  }

  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $healthUrl
    if ($response.StatusCode -eq 200) {
      [pscustomobject]@{
        ProcessId = $process.Id
        Port = $Port
        RequestId = $response.Headers['X-Request-Id']
      }
      exit 0
    }
  } catch {
    Start-Sleep -Milliseconds 100
  }
}

if (-not $process.HasExited) {
  Stop-Process -Id $process.Id -Force
}
throw "API process did not become healthy at $healthUrl."
