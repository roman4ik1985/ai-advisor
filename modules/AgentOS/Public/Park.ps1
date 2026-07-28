function Add-AgentOsParkedFileCore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string[]]$Path,
        [string]$Reason = "parked by user"
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot
    $policy = Get-AgentOsPolicy -RepositoryRoot $RepositoryRoot
    $baselineMap = Get-AgentOsBaselineEntryMap -Task $task

    foreach ($item in $Path) {
        $normalized = $item.Replace("\","/")

        if (-not $baselineMap.ContainsKey($normalized)) {
            throw "Cannot park '$normalized': it was not dirty in the task baseline."
        }

        $alreadyParked = @(
            Get-AgentOsParkedPaths -Task $task |
                Where-Object { $_ -eq $normalized }
        ).Count -gt 0

        if (-not $alreadyParked) {
            $task.parked_files = @($task.parked_files) + @(
                [ordered]@{
                    path = $normalized
                    reason = $Reason
                    added_at = [DateTimeOffset]::Now.ToString("o")
                    immutable = [bool]$policy.parked_files.immutable_during_task
                }
            )
        }
    }

    Save-AgentOsTaskAndManifest -Paths $paths -Task $task
    $task.parked_files
}

function Remove-AgentOsParkedFileCore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string[]]$Path,
        [switch]$Force
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot
    $policy = Get-AgentOsPolicy -RepositoryRoot $RepositoryRoot
    $removeSet = @{}

    foreach ($item in $Path) {
        $removeSet[$item.Replace("\","/")] = $true
    }

    $task.parked_files = @(
        $task.parked_files | Where-Object {
            $candidate =
                if ($_ -is [string]) { [string]$_ }
                else { [string]$_.path }

            $isRemoval = $removeSet.ContainsKey($candidate)
            if ($isRemoval -and $policy.parked_files.immutable_during_task -and $_ -isnot [string] -and [bool]$_.immutable -and -not $Force) {
                throw "Cannot remove immutable parked file '$candidate' without -Force."
            }

            -not $isRemoval
        }
    )

    Save-AgentOsTaskAndManifest -Paths $paths -Task $task
    $task.parked_files
}

function Get-AgentOsParkedFile {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot
    @($task.parked_files)
}
