function New-AgentOsTaskCore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$Goal,
        [Parameter(Mandatory)][string[]]$AllowedScope,
        [string[]]$ProtectedScope = @(),
        [string[]]$ParkedFiles = @(),
        [ValidateSet("LOW","MEDIUM","HIGH","CRITICAL")]
        [string]$RiskLevel = "MEDIUM",
        [switch]$AutoParkUnrelatedBaseline,
        [switch]$Force
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    Initialize-AgentOsDirectories -Paths $paths

    if ((Test-Path -LiteralPath $paths.CurrentTask) -and -not $Force) {
        throw "An active task already exists. Use -Force only after reviewing it."
    }

    $baseline = Get-AgentOsGitSnapshot -RepositoryRoot $RepositoryRoot
    $baseline = Add-AgentOsSnapshotFingerprints -RepositoryRoot $RepositoryRoot -Snapshot $baseline
    $effectiveParked = @($ParkedFiles)

    if ($AutoParkUnrelatedBaseline) {
        foreach ($entry in @($baseline.entries)) {
            $path = [string]$entry.Path

            $allowed = Test-AgentOsPathMatch -Path $path -Patterns $AllowedScope
            $protected = Test-AgentOsPathMatch -Path $path -Patterns $ProtectedScope

            if (-not $allowed -and -not $protected) {
                $effectiveParked += $path
            }
        }
    }

    $effectiveParked = @($effectiveParked | Sort-Object -Unique)
    $parkedObjects = @(
        $effectiveParked | ForEach-Object {
            [ordered]@{
                path = $_
                reason = "preexisting work parked for current task"
                added_at = [DateTimeOffset]::Now.ToString("o")
                immutable = $true
            }
        }
    )

    $id = "TASK-$((Get-Date).ToString('yyyy-MM-dd-HHmmss'))"

    $manifest = New-AgentOsManifestObject `
        -TaskId $id `
        -Title $Title `
        -Goal $Goal `
        -RepositoryRoot $RepositoryRoot `
        -Baseline $baseline `
        -AllowedScope $AllowedScope `
        -ProtectedScope $ProtectedScope `
        -ParkedFiles $parkedObjects `
        -RiskLevel $RiskLevel

    $validation = Test-AgentOsManifestObject -Manifest $manifest
    if (-not $validation.Valid) { throw "Generated manifest is invalid: $($validation.Errors -join '; ')" }

    $manifestPath = Join-Path $paths.Manifests "$id.manifest.json"
    Save-AgentOsJson -Value $manifest -Path $manifestPath

    $task = Convert-AgentOsManifestToTaskState -Manifest $manifest
    $task.manifest_path = $manifestPath

    Save-AgentOsTaskAndManifest -Paths $paths -Task $task
    $task
}

function Get-AgentOsTask {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $task = Read-AgentOsJson -Path $paths.CurrentTask

    if ($null -eq $task) {
        throw "No active Agent OS task."
    }

    $task
}

function Get-AgentOsManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot

    if (-not $task.manifest_path) {
        throw "Active task has no manifest path."
    }

    Read-AgentOsJson -Path $task.manifest_path
}

function Test-AgentOsManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    Test-AgentOsManifestObject -Manifest (Get-AgentOsManifest -RepositoryRoot $RepositoryRoot)
}
