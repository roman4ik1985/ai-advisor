[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetDirectory,
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

function Get-NormalizedFullPath([string]$Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $rootPath = [System.IO.Path]::GetPathRoot($fullPath)
  if ($fullPath.Length -gt $rootPath.Length) {
    return $fullPath.TrimEnd([char[]]@('\', '/'))
  }
  $fullPath
}

function Test-PathWithinRoot([string]$Path, [string]$Root) {
  $fullPath = Get-NormalizedFullPath $Path
  $fullRoot = Get-NormalizedFullPath $Root
  if ($fullPath.Equals($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  $prefix = if ($fullRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $fullRoot
  } else {
    $fullRoot + [System.IO.Path]::DirectorySeparatorChar
  }
  $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-ArchiveName([string]$Name, [string]$ExpectedProjectName) {
  $pattern = '^' + [regex]::Escape($ExpectedProjectName) + '-\d{8}-\d{6}(?:-\d{3})?\.7z$'
  if ([System.IO.Path]::GetFileName($Name) -ne $Name -or $Name -notmatch $pattern) {
    throw "ArchiveName must be a single file name matching '$ExpectedProjectName-YYYYMMDD-HHMMSS[-fff].7z'."
  }
}

$sevenZip = 'C:\Program Files\7-Zip\7z.exe'
$keyPath = Join-Path $ProjectRoot '.backup-key.dpapi'
$projectLog = Join-Path $ProjectRoot 'wiki\log.md'
$logHelper = Join-Path $PSScriptRoot 'append-wiki-log.ps1'
if (-not (Test-Path -LiteralPath $sevenZip)) { throw "7-Zip not found: $sevenZip" }
if (-not (Test-Path -LiteralPath $keyPath)) { throw 'The local DPAPI backup key is missing.' }
if (-not (Test-Path -LiteralPath $logHelper)) { throw "Canonical log helper not found: $logHelper" }
Assert-ArchiveName -Name $ArchiveName -ExpectedProjectName $ProjectName
foreach ($protectedRoot in @($ProjectRoot, 'F:\Services\AI Advisor')) {
  if (Test-PathWithinRoot -Path $TargetDirectory -Root $protectedRoot) {
    throw "Target directory must be outside protected project/runtime root: $protectedRoot"
  }
}
if (Test-Path -LiteralPath $TargetDirectory) { throw "Target directory already exists; restore requires a new empty path: $TargetDirectory" }

$driveArchive = Join-Path $DriveDirectory $ArchiveName
if (-not (Test-Path -LiteralPath $driveArchive)) { throw "Google Drive archive not found: $driveArchive" }

$password = Get-ArchivePassword $keyPath
try {
  & $sevenZip t "-p$password" $driveArchive | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Archive integrity test failed with exit code $LASTEXITCODE." }

  New-Item -ItemType Directory -Path $TargetDirectory -Force | Out-Null
  & $sevenZip x "-p$password" "-o$TargetDirectory" $driveArchive | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Archive extraction failed with exit code $LASTEXITCODE." }

  $required = @('.env', 'server.mjs', 'package.json', 'knowledge\store-faq.json')
  $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $TargetDirectory $_)) })
  if ($missing.Count -gt 0) { throw "Required restored files are missing: $($missing -join ', ')" }
  $forbidden = @('.git', 'node_modules', '_backups', '.backup-key.dpapi')
  $present = @($forbidden | Where-Object { Test-Path -LiteralPath (Join-Path $TargetDirectory $_) })
  if ($present.Count -gt 0) { throw "Excluded local-only paths were included: $($present -join ', ')" }

  $hash = (Get-FileHash -LiteralPath $driveArchive -Algorithm SHA256).Hash
  & $logHelper -Type implementation -Files 'scripts\restore-project.ps1, Google Drive, restored project' -Summary "Restored $ArchiveName into $TargetDirectory; archive SHA-256 $hash; required files verified and local-only paths excluded." -LogPath $projectLog | Out-Host
  [pscustomobject]@{ ProjectName = $ProjectName; ArchiveName = $ArchiveName; Archive = $ArchiveName; TargetDirectory = $TargetDirectory; Sha256 = $hash; RequiredFiles = $required.Count; ExcludedPaths = $forbidden.Count; Result = 'passed' }
} catch {
  if (Test-Path -LiteralPath $TargetDirectory) {
    & $logHelper -Type implementation -Files 'scripts\restore-project.ps1, Google Drive, restored project' -Summary "Restore of $ArchiveName to $TargetDirectory failed: $($_.Exception.Message). Partial target was intentionally retained for inspection." -LogPath $projectLog | Out-Host
  }
  throw
} finally {
  $password = $null
}
