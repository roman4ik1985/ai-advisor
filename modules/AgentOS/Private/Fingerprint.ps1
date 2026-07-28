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
