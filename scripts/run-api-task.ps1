param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8788
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$nodePath = @(
  (Get-Command node -ErrorAction SilentlyContinue).Source
  'C:\Program Files\nodejs\node.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if (-not $nodePath) {
  throw 'Node.js executable was not found.'
}

$stdoutPath = Join-Path $logDirectory 'ai-advisor-api.out.log'
$stderrPath = Join-Path $logDirectory 'ai-advisor-api.err.log'
$lifecycleLog = Join-Path $logDirectory 'ai-advisor-api-task.log'
$previousPort = $env:PORT
$env:PORT = [string]$Port

Add-Content -LiteralPath $lifecycleLog -Encoding utf8 -Value (
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') starting API task on port $Port"
)

Push-Location $projectRoot
try {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $nodePath '--env-file-if-exists=.env' 'server.mjs' '--provider=api' `
      1>> $stdoutPath 2>> $stderrPath
    $nodeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
} finally {
  Pop-Location
  if ($null -eq $previousPort) {
    Remove-Item Env:PORT -ErrorAction SilentlyContinue
  } else {
    $env:PORT = $previousPort
  }
}

Add-Content -LiteralPath $lifecycleLog -Encoding utf8 -Value (
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') API task exited with code $nodeExitCode"
)

if ($nodeExitCode -ne 0) {
  throw "AI Advisor API exited with code $nodeExitCode."
}
