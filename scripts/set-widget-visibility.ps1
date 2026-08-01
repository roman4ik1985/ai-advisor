[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("true", "false")]
    [string]$Enabled,

    [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$defaultConfigPath = Join-Path $projectRoot "public\widget-config.json"
$targetPath = if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $defaultConfigPath } else { $ConfigPath }
$resolvedPath = [System.IO.Path]::GetFullPath($targetPath)
$parentPath = Split-Path -Parent $resolvedPath
$enabledValue = [System.Convert]::ToBoolean($Enabled)

if (-not (Test-Path -LiteralPath $parentPath -PathType Container)) {
    throw "Widget config directory does not exist: $parentPath"
}

$payload = [ordered]@{ enabled = $enabledValue } | ConvertTo-Json
$temporaryPath = "$resolvedPath.$PID.tmp"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

try {
    [System.IO.File]::WriteAllText($temporaryPath, "$payload`n", $utf8NoBom)
    Move-Item -LiteralPath $temporaryPath -Destination $resolvedPath -Force
}
finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath -Force
    }
}

$state = if ($enabledValue) { "ENABLED" } else { "DISABLED" }
Write-Output "Widget visibility: $state ($resolvedPath)"
