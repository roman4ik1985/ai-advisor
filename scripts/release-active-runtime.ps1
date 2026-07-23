param(
  [string]$ActiveRoot = 'F:\Services\AI Advisor',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$releaseItems = @(
  'server.mjs',
  'package.json',
  'README.md',
  'TECHNICAL_SPECIFICATION.md',
  'public',
  'src',
  'scripts',
  'test',
  'knowledge'
)

if (-not (Test-Path -LiteralPath $ActiveRoot)) {
  throw "Active runtime directory does not exist: $ActiveRoot"
}

$changes = @()
foreach ($item in $releaseItems) {
  $sourcePath = Join-Path $sourceRoot $item
  $activePath = Join-Path $ActiveRoot $item
  if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Release item is missing: $sourcePath" }

  $sourceFiles = if ((Get-Item -LiteralPath $sourcePath).PSIsContainer) {
    Get-ChildItem -LiteralPath $sourcePath -File -Recurse
  } else {
    @(Get-Item -LiteralPath $sourcePath)
  }
  foreach ($sourceFile in $sourceFiles) {
    $relative = $sourceFile.FullName.Substring($sourceRoot.Length).TrimStart('\', '/')
    $target = Join-Path $ActiveRoot $relative
    $changed = -not (Test-Path -LiteralPath $target) -or
      (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($changed) { $changes += [pscustomobject]@{ RelativePath = $relative; Target = $target } }
  }
}

if (-not $Apply) {
  [pscustomobject]@{ Mode = 'dry-run'; SourceRoot = $sourceRoot; ActiveRoot = $ActiveRoot; ChangedFiles = $changes.RelativePath; Count = $changes.Count }
  return
}

foreach ($change in $changes) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $change.Target) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRoot $change.RelativePath) -Destination $change.Target -Force
}

foreach ($change in $changes) {
  $sourceHash = (Get-FileHash -LiteralPath (Join-Path $sourceRoot $change.RelativePath) -Algorithm SHA256).Hash
  $targetHash = (Get-FileHash -LiteralPath $change.Target -Algorithm SHA256).Hash
  if ($sourceHash -ne $targetHash) { throw "Hash verification failed: $($change.RelativePath)" }
}

[pscustomobject]@{ Mode = 'applied'; SourceRoot = $sourceRoot; ActiveRoot = $ActiveRoot; ChangedFiles = $changes.RelativePath; Count = $changes.Count }
