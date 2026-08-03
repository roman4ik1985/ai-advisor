[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$CollectorVersion,
  [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [switch]$SkipDownload
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Telemetry.Common.psm1') -Force
$p = Initialize-TelemetryDirectories -ProjectRoot $ProjectRoot

if (-not $SkipDownload) {
  $asset = "otelcol-contrib_${CollectorVersion}_windows_amd64.tar.gz"
  $base = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$CollectorVersion"
  $archive = Join-Path $env:TEMP $asset
  $checksums = Join-Path $env:TEMP "otelcol-contrib_${CollectorVersion}_checksums.txt"
  if ($PSCmdlet.ShouldProcess($p.ToolRoot, "Install OpenTelemetry Collector $CollectorVersion")) {
    Invoke-WebRequest "$base/$asset" -OutFile $archive
    Invoke-WebRequest "$base/otelcol-contrib_${CollectorVersion}_checksums.txt" -OutFile $checksums
    $expectedLine = Get-Content $checksums | Where-Object { $_ -match "\s+$([regex]::Escape($asset))$" } | Select-Object -First 1
    if (-not $expectedLine) { throw "Checksum entry not found for $asset" }
    $expected = ($expectedLine -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "SHA-256 mismatch for $asset" }
    Remove-Item -LiteralPath $p.ToolRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $p.ToolRoot -Force | Out-Null
    tar -xzf $archive -C $p.ToolRoot
    if (-not (Test-Path $p.CollectorExe)) { throw "Collector executable not found after extraction: $($p.CollectorExe)" }
    Set-Content -LiteralPath (Join-Path $p.ToolRoot 'VERSION') -Value $CollectorVersion -Encoding utf8
  }
}

$configText = Get-Content -LiteralPath $p.Config -Raw
$configText = $configText.Replace('C:/AI Advisor/', (($ProjectRoot -replace '\\','/') + '/'))
Write-AtomicUtf8 -Path $p.Config -Content $configText

if (-not (Test-Path $p.CodexConfig)) { throw "Codex config not found: $($p.CodexConfig)" }
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$($p.CodexConfig).backup-$timestamp"
Copy-Item -LiteralPath $p.CodexConfig -Destination $backup -Force
$toml = Get-Content -LiteralPath $p.CodexConfig -Raw
$otelBlock = @'
[otel]
environment = "dev"
log_user_prompt = false
exporter = { otlp-http = { endpoint = "http://127.0.0.1:4318/v1/logs", protocol = "binary" } }
trace_exporter = { otlp-http = { endpoint = "http://127.0.0.1:4318/v1/traces", protocol = "binary" } }
metrics_exporter = { otlp-http = { endpoint = "http://127.0.0.1:4318/v1/metrics", protocol = "binary" } }
'@
$pattern = '(?ms)^\[otel\]\s*.*?(?=^\[[^\]]+\]|\z)'
if ($toml -match $pattern) { $updated = [regex]::Replace($toml, $pattern, ($otelBlock.TrimEnd() + "`r`n`r`n"), 1) }
else { $updated = $toml.TrimEnd() + "`r`n`r`n" + $otelBlock.TrimEnd() + "`r`n" }
Write-AtomicUtf8 -Path $p.CodexConfig -Content $updated

[pscustomobject]@{ CollectorVersion=$CollectorVersion; CollectorExe=$p.CollectorExe; CodexConfig=$p.CodexConfig; Backup=$backup; FormalAcceptance='NOT_RUN' }
