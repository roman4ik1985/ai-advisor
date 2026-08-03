[CmdletBinding()]
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$DriveDirectory = 'G:\Мой диск\RcloneBackup\AI Advisor',
  [ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
  [string]$ProjectName = 'ai-advisor',
  [Parameter(Mandatory = $true)]
  [string]$ArchiveName
)

$ErrorActionPreference = 'Stop'

function Get-ArchivePassword([string]$KeyPath) {
  $secure = Get-Content -LiteralPath $KeyPath -Raw | ConvertTo-SecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Assert-ArchiveName([string]$Name, [string]$ExpectedProjectName) {
  $pattern = '^' + [regex]::Escape($ExpectedProjectName) + '-\d{8}-\d{6}(?:-\d{3})?\.7z$'
  if ([System.IO.Path]::GetFileName($Name) -ne $Name -or $Name -notmatch $pattern) {
    throw "ArchiveName must be a single file name matching '$ExpectedProjectName-YYYYMMDD-HHMMSS[-fff].7z'."
  }
}

$sevenZip = 'C:\Program Files\7-Zip\7z.exe'
$keyPath = Join-Path $ProjectRoot '.backup-key.dpapi'
if (-not (Test-Path -LiteralPath $sevenZip)) { throw "7-Zip not found: $sevenZip" }
if (-not (Test-Path -LiteralPath $keyPath)) { throw 'The local DPAPI backup key is missing.' }
Assert-ArchiveName -Name $ArchiveName -ExpectedProjectName $ProjectName

$driveArchive = Join-Path $DriveDirectory $ArchiveName
if (-not (Test-Path -LiteralPath $driveArchive)) { throw "Google Drive archive not found: $driveArchive" }

$smokeDirectory = Join-Path $ProjectRoot ('.backup-smoke\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$downloadDirectory = Join-Path $smokeDirectory 'download'
$extractDirectory = Join-Path $smokeDirectory 'extract'
$downloadedArchive = Join-Path $downloadDirectory $ArchiveName
New-Item -ItemType Directory -Path $downloadDirectory,$extractDirectory -Force | Out-Null
$password = Get-ArchivePassword $keyPath

try {
  Copy-Item -LiteralPath $driveArchive -Destination $downloadedArchive -Force
  $driveHash = (Get-FileHash -LiteralPath $driveArchive -Algorithm SHA256).Hash
  $downloadHash = (Get-FileHash -LiteralPath $downloadedArchive -Algorithm SHA256).Hash
  if ($driveHash -ne $downloadHash) { throw 'Downloaded archive hash differs from the Google Drive archive.' }

  & $sevenZip t "-p$password" $downloadedArchive | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Downloaded archive integrity test failed with exit code $LASTEXITCODE." }
  & $sevenZip x "-p$password" "-o$extractDirectory" $downloadedArchive | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Downloaded archive extraction failed with exit code $LASTEXITCODE." }

  $required = @('.env', 'server.mjs', 'package.json', 'knowledge\store-faq.json')
  $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $extractDirectory $_)) })
  if ($missing.Count -gt 0) { throw "Required restored files are missing: $($missing -join ', ')" }
  $forbidden = @('.git', 'node_modules', '_backups', '.backup-key.dpapi')
  $present = @($forbidden | Where-Object { Test-Path -LiteralPath (Join-Path $extractDirectory $_) })
  if ($present.Count -gt 0) { throw "Excluded local-only paths were included: $($present -join ', ')" }

  [pscustomobject]@{ ProjectName = $ProjectName; ArchiveName = $ArchiveName; Archive = $ArchiveName; Sha256 = $downloadHash; RequiredFiles = $required.Count; ExcludedPaths = $forbidden.Count; Result = 'passed' }
} finally {
  $password = $null
  if (Test-Path -LiteralPath $smokeDirectory) { Remove-Item -LiteralPath $smokeDirectory -Recurse -Force }
}
