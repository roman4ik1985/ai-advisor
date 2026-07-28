#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Get-Location).Path,
    [switch]$AddAlias
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$targetRoot = (Resolve-Path $RepositoryRoot).Path
$manifestPath = Join-Path $sourceRoot 'RELEASE-MANIFEST.json'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Release manifest not found: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ([string]$manifest.release -ne 'agent-os-v1.0.0' -or [string]$manifest.algorithm -ne 'SHA256') {
    throw 'Installer requires an Agent OS v1.0.0 SHA256 release manifest.'
}

foreach ($entry in @($manifest.files)) {
    $relative = ([string]$entry.path).Replace('/', [IO.Path]::DirectorySeparatorChar)
    if ([IO.Path]::IsPathRooted($relative) -or $relative.Split([IO.Path]::DirectorySeparatorChar) -contains '..') {
        throw "Unsafe release manifest path: $($entry.path)"
    }

    $source = Join-Path $sourceRoot $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Release package file is missing: $($entry.path)"
    }
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHash -ne [string]$entry.sha256) {
        throw "Release package hash mismatch: $($entry.path)"
    }

    $target = Join-Path $targetRoot $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
}

Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $targetRoot 'RELEASE-MANIFEST.json') -Force

Write-Host "Agent OS v1.0.0 installed into $targetRoot" -ForegroundColor Green

if ($AddAlias) {
    $line = "Set-Alias agent-os '$targetRoot\scripts\agent-os.ps1'"
    New-Item -ItemType File -Path $PROFILE -Force | Out-Null
    if (-not (Select-String -LiteralPath $PROFILE -SimpleMatch -Quiet -Pattern $line)) {
        Add-Content -LiteralPath $PROFILE -Value $line
    }
    Write-Host "Alias added to PowerShell profile: agent-os" -ForegroundColor Green
}
