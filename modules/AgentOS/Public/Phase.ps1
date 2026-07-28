function Set-AgentOsTaskPhaseCore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Phase,
        [string]$Note
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot
    $test = Test-AgentOsPhaseTransition -From ([string]$task.status) -To $Phase

    if (-not $test.Allowed) {
        throw "Invalid phase transition '$($task.status)' -> '$Phase'. $($test.Reason)"
    }

    if ($test.Idempotent) {
        return [pscustomobject]@{
            Status="NO_CHANGE"
            From=$task.status
            To=$Phase
        }
    }

    $from = [string]$task.status
    $task.status = $Phase
    $task.notes = @($task.notes) + @(
        [ordered]@{
            type="phase-transition"
            from=$from
            to=$Phase
            note=$Note
            created_at=[DateTimeOffset]::Now.ToString("o")
        }
    )
    Save-AgentOsTaskAndManifest -Paths $paths -Task $task

    [pscustomobject]@{
        Status="CHANGED"
        From=$from
        To=$Phase
    }
}
