function Get-AgentOsFileFingerprint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$RelativePath
    )

    $relative = $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $fullPath = Join-Path $RepositoryRoot $relative

    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        return [pscustomobject]@{ algorithm='SHA256'; exists=$false; hash=$null; length=$null }
    }

    $item = Get-Item -LiteralPath $fullPath
    $hash = Get-FileHash -LiteralPath $fullPath -Algorithm SHA256
    [pscustomobject]@{
        algorithm = 'SHA256'
        exists = $true
        hash = $hash.Hash.ToLowerInvariant()
        length = $item.Length
    }
}

function Add-AgentOsSnapshotFingerprints {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)]$Snapshot
    )

    foreach ($entry in @($Snapshot.entries)) {
        $entry | Add-Member -NotePropertyName fingerprint -NotePropertyValue (
            Get-AgentOsFileFingerprint -RepositoryRoot $RepositoryRoot -RelativePath ([string]$entry.Path)
        ) -Force
    }
    $Snapshot
}

function Get-AgentOsProtectedFileInventory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [AllowEmptyCollection()][string[]]$Patterns = @()
    )

    if (@($Patterns).Count -eq 0) {
        return @()
    }

    $root = (Resolve-Path -LiteralPath $RepositoryRoot).Path.TrimEnd([char[]]@('\', '/'))
    $directories = New-Object 'System.Collections.Generic.Stack[string]'
    $directories.Push($root)
    $inventory = @()
    $agentOsInternalPatterns = @(
        '.agent-os/*',
        '.agent-os/evidence/**',
        '.agent-os/state/**',
        '.agent-os/manifests/**',
        '.agent-os/tasks/**',
        '.agent-os/logs/**',
        '.agent-os/savepoints/**'
    )

    while ($directories.Count -gt 0) {
        $directory = $directories.Pop()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
            $relativePath = $item.FullName.Substring($root.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')

            if ($relativePath -eq '.git' -or $relativePath.StartsWith('.git/')) {
                continue
            }

            if (Test-AgentOsPathMatch -Path $relativePath -Patterns $agentOsInternalPatterns) {
                continue
            }

            if ($item.PSIsContainer) {
                if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
                    $directories.Push($item.FullName)
                }
                continue
            }

            if (Test-AgentOsPathMatch -Path $relativePath -Patterns $Patterns) {
                $inventory += [pscustomobject]@{
                    Path        = $relativePath
                    Fingerprint = Get-AgentOsFileFingerprint -RepositoryRoot $root -RelativePath $relativePath
                }
            }
        }
    }

    return @($inventory | Sort-Object Path)
}

function Test-AgentOsFingerprintEqual {
    [CmdletBinding()]
    param($Baseline,$Current)

    if ($null -eq $Baseline -or $null -eq $Current) { return $false }
    if ([bool]$Baseline.exists -ne [bool]$Current.exists) { return $false }
    if (-not [bool]$Baseline.exists) { return $true }

    return ([string]$Baseline.algorithm -eq [string]$Current.algorithm -and
            [string]$Baseline.hash -eq [string]$Current.hash -and
            [long]$Baseline.length -eq [long]$Current.length)
}
