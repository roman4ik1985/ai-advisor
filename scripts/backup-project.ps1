[CmdletBinding()]
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$DriveDirectory = 'G:\Мой диск\RcloneBackup\AI Advisor',
  [ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
  [string]$ProjectName = 'ai-advisor',
  [ValidateRange(1, 3650)]
  [int]$RetentionDays = 90
)

$ErrorActionPreference = 'Stop'

function Get-ArchivePassword([string]$KeyPath) {
  if (-not (Test-Path -LiteralPath $KeyPath)) {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $plain = [Convert]::ToBase64String($bytes)
    $secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
    ConvertFrom-SecureString -SecureString $secure | Set-Content -LiteralPath $KeyPath -Encoding ascii -NoNewline
  }

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

$sevenZip = 'C:\Program Files\7-Zip\7z.exe'
if (-not (Test-Path -LiteralPath $sevenZip)) { throw "7-Zip not found: $sevenZip" }
if (-not (Test-Path -LiteralPath $ProjectRoot)) { throw "Project root not found: $ProjectRoot" }
if ((Get-NormalizedFullPath $ProjectRoot) -eq [System.IO.Path]::GetPathRoot((Get-NormalizedFullPath $ProjectRoot))) {
  throw "ProjectRoot must not be a filesystem root: $ProjectRoot"
}
if (Test-PathWithinRoot -Path $DriveDirectory -Root $ProjectRoot) {
  throw "DriveDirectory must be outside ProjectRoot to prevent recursive backup capture: $DriveDirectory"
}
if (-not (Test-Path -LiteralPath $DriveDirectory)) { New-Item -ItemType Directory -Path $DriveDirectory -Force | Out-Null }

$backupDirectory = Join-Path $ProjectRoot '_backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$keyPath = Join-Path $ProjectRoot '.backup-key.dpapi'
$projectLog = Join-Path $ProjectRoot 'wiki\log.md'
$logHelper = Join-Path $PSScriptRoot 'append-wiki-log.ps1'
if (-not (Test-Path -LiteralPath $logHelper)) { throw "Canonical log helper not found: $logHelper" }
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$ArchiveName = "$ProjectName-$timestamp.7z"
$archivePath = Join-Path $backupDirectory $ArchiveName
$drivePath = Join-Path $DriveDirectory $ArchiveName
if (Test-Path -LiteralPath $archivePath) { throw "Local archive already exists: $archivePath" }
if (Test-Path -LiteralPath $drivePath) { throw "Drive archive already exists: $drivePath" }
$password = Get-ArchivePassword $keyPath

try {
  & $sevenZip a -t7z -mx=9 -mhe=on "-p$password" $archivePath (Join-Path $ProjectRoot '*') '-xr!.git' '-xr!node_modules' '-xr!logs' '-xr!_backups' '-xr!.backup-smoke' '-xr!.backup-key.dpapi' '-xr!.codex' '-xr!*.log' '-xr!*.zip' | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "7-Zip archive creation failed with exit code $LASTEXITCODE." }

  & $sevenZip t "-p$password" $archivePath | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "7-Zip archive integrity test failed with exit code $LASTEXITCODE." }

  Copy-Item -LiteralPath $archivePath -Destination $drivePath -Force
  $localHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  $driveHash = (Get-FileHash -LiteralPath $drivePath -Algorithm SHA256).Hash
  if ($localHash -ne $driveHash) { throw 'Google Drive copy hash differs from the local archive.' }

  $cutoff = (Get-Date).AddDays(-$RetentionDays)
  $removed = @(Get-ChildItem -LiteralPath $backupDirectory -File -Filter "$ProjectName-*.7z" | Where-Object LastWriteTime -lt $cutoff)
  $removed += @(Get-ChildItem -LiteralPath $DriveDirectory -File -Filter "$ProjectName-*.7z" | Where-Object LastWriteTime -lt $cutoff)
  foreach ($item in $removed) { Remove-Item -LiteralPath $item.FullName -Force }

  & $logHelper -Type implementation -Files 'scripts\backup-project.ps1, _backups, Google Drive' -Summary "Created encrypted archive $ArchiveName; 7-Zip integrity and Google Drive copy SHA-256 passed; retention $RetentionDays days, removed $($removed.Count) expired archive(s)." -LogPath $projectLog | Out-Host
  [pscustomobject]@{ ProjectName = $ProjectName; ArchiveName = $ArchiveName; Archive = $archivePath; DriveCopy = $drivePath; Sha256 = $localHash; RetentionDays = $RetentionDays; Removed = $removed.Count }
} finally {
  $password = $null
}
