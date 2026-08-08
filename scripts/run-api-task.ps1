param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8788,
  [switch]$AllowTelegramEnabled,
  [string]$SecretStorePath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
. (Join-Path $PSScriptRoot 'system-secret-store.ps1')

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

# The SYSTEM secret store owns protected values. Read only the two explicit,
# non-secret learning settings from .env so the child does not receive the
# rest of the dotenv file.
$learningEnvironment = @{}
$dotenvPath = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $dotenvPath -PathType Leaf) {
  foreach ($line in Get-Content -LiteralPath $dotenvPath) {
    if ($line -match '^\s*(LEARNING_LOG_ENABLED|LEARNING_LOG_FILE)\s*=\s*(.*?)\s*$') {
      $value = $Matches[2].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $learningEnvironment[$Matches[1]] = $value
    }
  }
}

Add-Content -LiteralPath $lifecycleLog -Encoding utf8 -Value (
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') starting API task on port $Port"
)

$secretValues = $null
$process = $null
$stdoutStream = $null
$stderrStream = $null
try {
  try {
    if ([string]::IsNullOrWhiteSpace($SecretStorePath)) {
      $secretValues = Read-SystemSecretStore `
        -RequireSystemIdentity `
        -AllowTelegramEnabled:$AllowTelegramEnabled
    } else {
      $secretValues = Read-SystemSecretStore `
        -Path $SecretStorePath `
        -RequireSystemIdentity `
        -AllowTelegramEnabled:$AllowTelegramEnabled
    }
  } catch {
    Add-Content -LiteralPath $lifecycleLog -Encoding utf8 -Value (
      "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') SYSTEM_SECRET_LOAD_FAILED"
    )
    throw 'SYSTEM_SECRET_LOAD_FAILED'
  }

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $nodePath
  $startInfo.Arguments = 'server.mjs --provider=api'
  $startInfo.WorkingDirectory = $projectRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $baseEnvironment = @{}
  foreach ($name in Get-SystemSecretChildEnvironmentNames) {
    if ($startInfo.EnvironmentVariables.ContainsKey($name)) {
      $baseEnvironment[$name] = $startInfo.EnvironmentVariables[$name]
    }
  }
  $startInfo.EnvironmentVariables.Clear()
  foreach ($name in @($baseEnvironment.Keys)) {
    $startInfo.EnvironmentVariables[[string]$name] = [string]$baseEnvironment[$name]
  }
  foreach ($name in @($secretValues.Keys)) {
    $startInfo.EnvironmentVariables[[string]$name] = [string]$secretValues[$name]
  }
  foreach ($name in @($learningEnvironment.Keys)) {
    $startInfo.EnvironmentVariables[[string]$name] = [string]$learningEnvironment[$name]
  }
  $startInfo.EnvironmentVariables['PORT'] = [string]$Port

  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'SYSTEM_SECRET_NODE_START_FAILED'
  }

  foreach ($name in @($secretValues.Keys)) {
    $secretValues[$name] = $null
    [void]$startInfo.EnvironmentVariables.Remove([string]$name)
  }
  $secretValues.Clear()

  $stdoutStream = New-Object IO.FileStream(
    $stdoutPath,
    [IO.FileMode]::Append,
    [IO.FileAccess]::Write,
    [IO.FileShare]::ReadWrite
  )
  $stderrStream = New-Object IO.FileStream(
    $stderrPath,
    [IO.FileMode]::Append,
    [IO.FileAccess]::Write,
    [IO.FileShare]::ReadWrite
  )
  $stdoutCopy = $process.StandardOutput.BaseStream.CopyToAsync($stdoutStream)
  $stderrCopy = $process.StandardError.BaseStream.CopyToAsync($stderrStream)
  $process.WaitForExit()
  try {
    [Threading.Tasks.Task]::WaitAll(@($stdoutCopy, $stderrCopy))
  } catch {
    throw 'SYSTEM_SECRET_LOG_FORWARDING_FAILED'
  }
  $nodeExitCode = $process.ExitCode
} finally {
  if ($secretValues) {
    foreach ($name in @($secretValues.Keys)) {
      $secretValues[$name] = $null
    }
    $secretValues.Clear()
  }
  if ($stdoutStream) { $stdoutStream.Dispose() }
  if ($stderrStream) { $stderrStream.Dispose() }
  if ($process) { $process.Dispose() }
}

Add-Content -LiteralPath $lifecycleLog -Encoding utf8 -Value (
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') API task exited with code $nodeExitCode"
)

if ($nodeExitCode -ne 0) {
  throw "AI Advisor API exited with code $nodeExitCode."
}
