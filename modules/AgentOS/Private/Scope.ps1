function Convert-AgentOsWildcardToRegex {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Pattern
    )

    $normalized = $Pattern.Replace('\', '/').TrimStart('.', '/')
    $builder = [System.Text.StringBuilder]::new()
    $index = 0

    while ($index -lt $normalized.Length) {
        $character = $normalized[$index]

        if ($character -eq '*') {
            $hasSecondStar =
                ($index + 1 -lt $normalized.Length) -and
                ($normalized[$index + 1] -eq '*')

            if ($hasSecondStar) {
                $followedBySlash =
                    ($index + 2 -lt $normalized.Length) -and
                    ($normalized[$index + 2] -eq '/')

                if ($followedBySlash) {
                    [void]$builder.Append('(?:.*/)?')
                    $index += 3
                }
                else {
                    [void]$builder.Append('.*')
                    $index += 2
                }

                continue
            }

            [void]$builder.Append('[^/]*')
            $index++
            continue
        }

        if ($character -eq '?') {
            [void]$builder.Append('[^/]')
            $index++
            continue
        }

        [void]$builder.Append([Regex]::Escape([string]$character))
        $index++
    }

    return '^' + $builder.ToString() + '$'
}

function Test-AgentOsPathMatch {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Patterns
    )

    $normalizedPath = $Path.Replace('\', '/').TrimStart('.', '/')

    foreach ($patternValue in @($Patterns)) {
        $pattern = [string]$patternValue

        if (
            -not [string]::IsNullOrWhiteSpace($pattern) -and
            $normalizedPath -match (Convert-AgentOsWildcardToRegex -Pattern $pattern)
        ) {
            return $true
        }
    }

    return $false
}

function Get-AgentOsBaselineEntryMap {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        $Task
    )

    $map = @{}

    foreach ($entry in @($Task.baseline.entries)) {
        $map[[string]$entry.Path] = $entry
    }

    return $map
}

function Get-AgentOsParkedPaths {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        $Task
    )

    return @(
        foreach ($item in @($Task.parked_files)) {
            if ($item -is [string]) {
                [string]$item
            }
            else {
                [string]$item.path
            }
        }
    )
}

function Get-AgentOsProtectedFilesystemDrift {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)]$Task,
        [AllowEmptyCollection()][string[]]$GitPaths = @()
    )

    $baselineProperty = $Task.baseline.PSObject.Properties['protected_files']
    if ($null -eq $baselineProperty) {
        return @()
    }

    $baseline = @{}
    foreach ($entry in @($baselineProperty.Value)) {
        $baseline[[string]$entry.Path] = $entry.Fingerprint
    }

    $current = @{}
    foreach ($entry in @(Get-AgentOsProtectedFileInventory -RepositoryRoot $RepositoryRoot -Patterns @($Task.protected_scope))) {
        $current[[string]$entry.Path] = $entry.Fingerprint
    }

    $drift = @()
    foreach ($path in @($baseline.Keys + $current.Keys | Sort-Object -Unique)) {
        if (@($GitPaths) -contains $path) {
            continue
        }

        $change = if (-not $baseline.ContainsKey($path)) {
            'CREATED'
        }
        elseif (-not $current.ContainsKey($path)) {
            'DELETED'
        }
        elseif (-not (Test-AgentOsFingerprintEqual $baseline[$path] $current[$path])) {
            'MODIFIED'
        }
        else {
            $null
        }

        if ($null -ne $change) {
            $drift += [pscustomobject]@{
                Code                 = 'FS'
                BaselineCode         = $null
                Path                 = $path
                Staged               = $false
                Worktree             = $false
                Untracked            = $false
                WasDirtyAtStart      = $baseline.ContainsKey($path)
                IsParked             = $false
                FingerprintUnchanged = $false
                FilesystemDrift      = $change
                Classification       = 'PROTECTED'
            }
        }
    }

    return @($drift)
}

function Get-AgentOsScopeClassification {
    [CmdletBinding()]
    param(
        [string]$RepositoryRoot = (Get-Location).Path,

        [Parameter(Mandatory)]
        [object[]]$Entries,

        [Parameter(Mandatory)]
        $Task
    )

    $repositoryRootWasProvided = $PSBoundParameters.ContainsKey('RepositoryRoot')
    $baseline = Get-AgentOsBaselineEntryMap -Task $Task
    $parked = @(Get-AgentOsParkedPaths -Task $Task)

    # Internal whitelist: Agent OS own artifacts are never user changes
    $agentOsInternalPatterns = @(
        # Root-level files are runtime artifacts, not package configuration.
        # Keep config/** and templates/** available for explicit release work.
        '.agent-os/*',
        '.agent-os/evidence/**',
        '.agent-os/state/**',
        '.agent-os/manifests/**',
        '.agent-os/tasks/**',
        '.agent-os/logs/**',
        '.agent-os/savepoints/**'
    )

    foreach ($entry in @($Entries)) {
        $path = [string]$entry.Path

        # Skip Agent OS internal artifacts — they are system-generated, not user changes
        $isAgentInternal = Test-AgentOsPathMatch -Path $path -Patterns $agentOsInternalPatterns
        if ($isAgentInternal) {
            [pscustomobject]@{
                Code                 = $entry.Code
                BaselineCode         = $null
                Path                 = $path
                Staged               = [bool]$entry.Staged
                Worktree             = [bool]$entry.Worktree
                Untracked            = [bool]$entry.Untracked
                WasDirtyAtStart      = $false
                IsParked             = $false
                FingerprintUnchanged = $null
                FilesystemDrift      = $null
                Classification       = 'AGENT_INTERNAL'
            }
            continue
        }

        $protected = Test-AgentOsPathMatch -Path $path -Patterns @($Task.protected_scope)
        $allowed = Test-AgentOsPathMatch -Path $path -Patterns @($Task.allowed_scope)
        $isParked = Test-AgentOsPathMatch -Path $path -Patterns $parked
        $wasDirty = $baseline.ContainsKey($path)

        $baselineFingerprint = if ($wasDirty) {
            $baseline[$path].fingerprint
        }
        else {
            $null
        }

        $currentFingerprint = if ($wasDirty -and -not $repositoryRootWasProvided) {
            $baselineFingerprint
        }
        else {
            Get-AgentOsFileFingerprint -RepositoryRoot $RepositoryRoot -RelativePath $path
        }

        $fingerprintUnchanged = if ($wasDirty) {
            if ($null -ne $baselineFingerprint -and $baselineFingerprint -eq $currentFingerprint) {
                $true
            }
            else {
                Test-AgentOsFingerprintEqual $baselineFingerprint $currentFingerprint
            }
        }
        else {
            $null
        }

        $classification = if ($wasDirty -and $fingerprintUnchanged -and -not $entry.Staged) {
            if ($isParked) {
                'PREEXISTING_PARKED'
            }
            elseif ($allowed) {
                'PREEXISTING_ALLOWED'
            }
            else {
                'PREEXISTING_UNCHANGED'
            }
        }
        elseif ($protected) {
            'PROTECTED'
        }
        elseif ($isParked -and $wasDirty -and $fingerprintUnchanged) {
            'PREEXISTING_PARKED'
        }
        elseif ($isParked -and $wasDirty) {
            'PARKED_DRIFT'
        }
        elseif ($allowed -and $wasDirty) {
            'PREEXISTING_ALLOWED'
        }
        elseif ($allowed) {
            'NEW_ALLOWED'
        }
        elseif ($wasDirty) {
            'PREEXISTING_UNCLASSIFIED'
        }
        else {
            'NEW_UNEXPECTED'
        }

        [pscustomobject]@{
            Code                 = $entry.Code
            BaselineCode         = if ($wasDirty) { $baseline[$path].Code } else { $null }
            Path                 = $path
            Staged               = [bool]$entry.Staged
            Worktree             = [bool]$entry.Worktree
            Untracked            = [bool]$entry.Untracked
            WasDirtyAtStart      = $wasDirty
            IsParked             = $isParked
            FingerprintUnchanged = $fingerprintUnchanged
            FilesystemDrift      = $null
            Classification       = $classification
        }
    }

    if ($repositoryRootWasProvided) {
        Get-AgentOsProtectedFilesystemDrift `
            -RepositoryRoot $RepositoryRoot `
            -Task $Task `
            -GitPaths @($Entries | ForEach-Object { [string]$_.Path })
    }
}

function Test-AgentOsScopePass {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [object[]]$Classified,
        [Parameter(Mandatory)]$Policy
    )

    $blockingClasses = @('PROTECTED')
    if ([bool]$Policy.parked_files.block_on_drift) { $blockingClasses += 'PARKED_DRIFT' }
    $blockingClasses += @('NEW_UNEXPECTED', 'PREEXISTING_UNCLASSIFIED')
    $blocking = @($Classified | Where-Object { $_.Classification -in $blockingClasses })

    return [pscustomobject]@{
        Passed   = ($blocking.Count -eq 0)
        Blocking = $blocking
    }
}
