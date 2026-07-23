$ErrorActionPreference = 'Stop'
$packageRoot = 'C:\Users\roman\AppData\Roaming\npm\node_modules\codex-telegram-bridge'
$bridgeEntry = Join-Path $packageRoot 'dist\bridge.js'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$logDirectory = 'C:\Users\roman\.codex\telegram-bridge\logs'

if (-not (Test-Path -LiteralPath $bridgeEntry)) {
  throw "Telegram bridge entrypoint was not found at $bridgeEntry."
}
if (-not (Test-Path -LiteralPath $nodePath)) {
  throw "Node.js executable was not found at $nodePath."
}

$existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -match 'dist[\\/]bridge\.js'
  } |
  Select-Object -First 1
if ($existing) {
  [pscustomobject]@{ Started = $false; ProcessId = $existing.ProcessId }
  exit 0
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$process = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @('dist\bridge.js') `
  -WorkingDirectory $packageRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDirectory 'bridge-background.out.log') `
  -RedirectStandardError (Join-Path $logDirectory 'bridge-background.err.log') `
  -PassThru

Start-Sleep -Seconds 3
if ($process.HasExited) {
  throw "Telegram bridge exited during startup with code $($process.ExitCode)."
}

[pscustomobject]@{ Started = $true; ProcessId = $process.Id }
