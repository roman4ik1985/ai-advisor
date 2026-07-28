[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Join-Path $PSScriptRoot '..')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
. (Join-Path $repoRoot 'modules\AgentOS\Private\Release.ps1')

$packagePaths = @(
    '.agent-os/config',
    '.agent-os/templates',
    'modules/AgentOS',
    'scripts/agent-os.ps1',
    'scripts/install-agent-os.ps1'
)
$allowedExtensions = @('.json', '.ps1', '.psm1', '.psd1')
$candidates = @(
    foreach ($packagePath in $packagePaths) {
        $fullPath = Join-Path $repoRoot $packagePath
        if (Test-Path -LiteralPath $fullPath -PathType Container) {
            Get-ChildItem -LiteralPath $fullPath -File -Recurse
        }
        elseif (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            Get-Item -LiteralPath $fullPath
        }
        else {
            throw "Release package path is missing: $packagePath"
        }
    }
)
$files = @($candidates | Where-Object { $_.Extension -in $allowedExtensions } | Sort-Object FullName)

$manifest = [ordered]@{
    schema_version = '1.0'
    release = 'agent-os-v1.0.0'
    generated_at = [DateTimeOffset]::Now.ToString('o')
    algorithm = 'SHA256'
    content_normalization = 'UTF-8 LF'
    files = @(
        foreach ($file in $files) {
            $relativePath = $file.FullName.Substring($repoRoot.Length).TrimStart('\', '/').Replace('\', '/')
            $hash = Get-AgentOsCanonicalReleaseHash -Path $file.FullName
            [ordered]@{ path = $relativePath; size = $hash.Length; sha256 = $hash.Hash }
        }
    )
}

$manifestPath = Join-Path $repoRoot 'RELEASE-MANIFEST.json'
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "Generated $($manifest.files.Count)-file canonical Agent OS release manifest." -ForegroundColor Green
