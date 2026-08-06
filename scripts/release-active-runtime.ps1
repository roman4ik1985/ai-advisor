param(
  [string]$ActiveRoot = 'F:\Services\AI Advisor',
  [ValidateSet('P3P4Runtime', 'SYSTEMSecretLoader', 'TelegramCustomerRuntime', 'KnowledgeRuntime', 'SalesDriveRuntime', 'PolicyKnowledgeRuntime', 'ApiProviderRuntime', 'MultiOperatorRuntime')]
  [string]$Profile = 'P3P4Runtime',
  [switch]$Apply,
  [string]$RollbackFrom
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$backupRoot = Join-Path $ActiveRoot '_release-backups'
$protectedRuntimePaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
[void]$protectedRuntimePaths.Add('public\widget-config.json')

$releaseProfiles = @{
  P3P4Runtime = @(
    'server.mjs',
    'live-resolvers.mjs',
    'product-specification-evidence.mjs',
    'product-analytics.mjs',
    'readiness-slo.mjs',
    'rate-limit-strategy.mjs',
    'request-pipeline.mjs',
    'public\widget.js',
    'knowledge\product-specifications.json'
  )
  SYSTEMSecretLoader = @(
    'scripts\run-api-task.ps1',
    'scripts\system-secret-store.ps1'
  )
  TelegramCustomerRuntime = @(
    'server.mjs',
    'telegram-order-runtime.mjs',
    'telegram-order-redis-client.mjs',
    'telegram-order-redis-store.mjs',
    'telegram-order-redis-rate-limit.mjs',
    'telegram-order-sender.mjs',
    'telegram-order-outbox.mjs',
    'telegram-order-action-sink.mjs',
    'telegram-order-webhook.mjs',
    'telegram-order-menu.mjs',
    'telegram-order-binding.mjs',
    'telegram-order-provisioning.mjs',
    'salesdrive-order-provisioning.mjs',
    'telegram-owned-order-service.mjs',
    'salesdrive-order-client.mjs',
    'order-ownership-contract.mjs',
    'order-dto.mjs'
  )
  KnowledgeRuntime = @(
    'knowledge\store-faq.json'
  )
  SalesDriveRuntime = @(
    'salesdrive-api.mjs',
    'src\learning-log.mjs'
  )
  PolicyKnowledgeRuntime = @(
        'intent-router.mjs',
        'request-pipeline.mjs',
        'live-response-renderer.mjs'
  )
  ApiProviderRuntime = @(
    'server.mjs',
    'analytics-pilot.mjs',
    'src\providers\api-provider.mjs'
  )
  MultiOperatorRuntime = @(
    'server.mjs',
    'src\operator-registry.mjs',
    'src\prompt.mjs',
    'src\learning-log.mjs',
    'analytics-pilot.mjs',
    'public\widget.js',
    'public\widget.css'
  )
}

function Resolve-ContainedPath {
  param(
    [Parameter(Mandatory)] [string]$Root,
    [Parameter(Mandatory)] [string]$Path,
    [switch]$MustExist
  )

  $resolvedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  if ($resolvedPath -ne $resolvedRoot -and -not $resolvedPath.StartsWith("$resolvedRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escapes allowed root: $Path"
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolvedPath)) {
    throw "Required path does not exist: $resolvedPath"
  }
  return $resolvedPath
}

if (-not (Test-Path -LiteralPath $ActiveRoot)) {
  throw "Active runtime directory does not exist: $ActiveRoot"
}
$ActiveRoot = (Resolve-Path -LiteralPath $ActiveRoot).Path.TrimEnd('\')
$backupRoot = Join-Path $ActiveRoot '_release-backups'

if ($Apply -and $RollbackFrom) {
  throw 'Apply and RollbackFrom are mutually exclusive.'
}

if ($RollbackFrom) {
  $manifestPath = Resolve-ContainedPath -Root $backupRoot -Path $RollbackFrom -MustExist
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.profile -notin @('P3P4Runtime', 'SYSTEMSecretLoader', 'TelegramCustomerRuntime', 'KnowledgeRuntime', 'SalesDriveRuntime', 'PolicyKnowledgeRuntime', 'ApiProviderRuntime', 'MultiOperatorRuntime')) {
    throw "Unsupported rollback manifest: $manifestPath"
  }
  if ([System.IO.Path]::GetFullPath([string]$manifest.activeRoot).TrimEnd('\') -ne $ActiveRoot) {
    throw 'Rollback manifest belongs to a different active runtime.'
  }

  $backupDirectory = Split-Path -Parent $manifestPath
  foreach ($entry in $manifest.files) {
    $relative = ([string]$entry.relativePath).Replace('/', '\')
    if ($protectedRuntimePaths.Contains($relative)) { throw "Protected runtime path in rollback manifest: $relative" }
    $target = Resolve-ContainedPath -Root $ActiveRoot -Path (Join-Path $ActiveRoot $relative)
    if ($entry.existed) {
      $backupFile = Resolve-ContainedPath -Root $backupDirectory -Path (Join-Path $backupDirectory $relative) -MustExist
      New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
      Copy-Item -LiteralPath $backupFile -Destination $target -Force
      $restoredHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
      if ($restoredHash -ne [string]$entry.previousHash) { throw "Rollback hash verification failed: $relative" }
    } elseif (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Force
    }
  }

  [pscustomobject]@{ Mode = 'rolled-back'; Profile = $manifest.profile; ActiveRoot = $ActiveRoot; Manifest = $manifestPath; Count = @($manifest.files).Count }
  return
}

$releaseItems = @($releaseProfiles[$Profile])
foreach ($item in $releaseItems) {
  $normalized = $item.Replace('/', '\')
  if ($protectedRuntimePaths.Contains($normalized)) { throw "Release profile contains protected runtime path: $normalized" }
}

$trackedFiles = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
@(& git -C $sourceRoot ls-files) | ForEach-Object { [void]$trackedFiles.Add($_.Replace('/', '\')) }
if ($LASTEXITCODE -ne 0 -or $trackedFiles.Count -eq 0) {
  throw "Release source must be a Git worktree with tracked files: $sourceRoot"
}

$dirtyReleaseFiles = @(& git -C $sourceRoot diff --name-only HEAD -- $releaseItems)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect release source changes.' }
if ($dirtyReleaseFiles.Count -gt 0) {
  throw "Release source has uncommitted tracked changes: $($dirtyReleaseFiles -join ', ')"
}

$changes = @()
foreach ($item in $releaseItems) {
  $relative = $item.Replace('/', '\')
  if (-not $trackedFiles.Contains($relative)) { throw "Release item is not tracked by Git: $relative" }
  $sourcePath = Resolve-ContainedPath -Root $sourceRoot -Path (Join-Path $sourceRoot $relative) -MustExist
  $target = Resolve-ContainedPath -Root $ActiveRoot -Path (Join-Path $ActiveRoot $relative)
  $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
  $targetExists = Test-Path -LiteralPath $target
  $targetHash = if ($targetExists) { (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash } else { $null }
  if (-not $targetExists -or $sourceHash -ne $targetHash) {
    $changes += [pscustomobject]@{
      RelativePath = $relative
      Source = $sourcePath
      Target = $target
      SourceHash = $sourceHash
      TargetExists = $targetExists
      PreviousHash = $targetHash
    }
  }
}

if (-not $Apply) {
  [pscustomobject]@{ Mode = 'dry-run'; Profile = $Profile; SourceRoot = $sourceRoot; ActiveRoot = $ActiveRoot; ChangedFiles = $changes.RelativePath; Count = $changes.Count }
  return
}

if ($Profile -eq 'SYSTEMSecretLoader') {
  . (Join-Path $sourceRoot 'scripts\system-secret-store.ps1')
  $releaseReadiness = Test-SystemSecretStoreReleaseReadiness
  if (-not $releaseReadiness.Ready) {
    throw "SYSTEM_SECRET_RELEASE_BLOCKED:$($releaseReadiness.Code)"
  }
}

$backupDirectory = Join-Path $backupRoot ("{0}-{1}" -f $Profile.ToLowerInvariant(), (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$backupDirectory = Resolve-ContainedPath -Root $backupRoot -Path $backupDirectory
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

$manifestEntries = @()
foreach ($change in $changes) {
  if ($change.TargetExists) {
    $backupFile = Resolve-ContainedPath -Root $backupDirectory -Path (Join-Path $backupDirectory $change.RelativePath)
    New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null
    Copy-Item -LiteralPath $change.Target -Destination $backupFile -Force
    if ((Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash -ne $change.PreviousHash) {
      throw "Backup hash verification failed: $($change.RelativePath)"
    }
  }
  $manifestEntries += [ordered]@{
    relativePath = $change.RelativePath
    existed = [bool]$change.TargetExists
    sourceHash = $change.SourceHash
    previousHash = $change.PreviousHash
  }
}

$sourceHead = (& git -C $sourceRoot rev-parse HEAD).Trim()
$manifest = [ordered]@{
  schemaVersion = 1
  profile = $Profile
  sourceHead = $sourceHead
  activeRoot = $ActiveRoot
  createdAt = (Get-Date).ToString('o')
  files = $manifestEntries
}
$manifestPath = Join-Path $backupDirectory 'manifest.json'
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

foreach ($change in $changes) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $change.Target) -Force | Out-Null
  Copy-Item -LiteralPath $change.Source -Destination $change.Target -Force
}
foreach ($change in $changes) {
  $targetHash = (Get-FileHash -LiteralPath $change.Target -Algorithm SHA256).Hash
  if ($change.SourceHash -ne $targetHash) { throw "Hash verification failed: $($change.RelativePath)" }
}

[pscustomobject]@{
  Mode = 'applied'
  Profile = $Profile
  SourceRoot = $sourceRoot
  ActiveRoot = $ActiveRoot
  ChangedFiles = $changes.RelativePath
  Count = $changes.Count
  BackupManifest = $manifestPath
  RollbackCommand = "pwsh -NoProfile -File `"$PSCommandPath`" -ActiveRoot `"$ActiveRoot`" -RollbackFrom `"$manifestPath`""
}
