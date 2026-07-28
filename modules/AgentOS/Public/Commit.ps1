function Test-AgentOsCommitCore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [switch]$AllowNoStagedFiles
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot

    Assert-AgentOsRequiredGates -Task $task -GateNames @("manifest_validation","scope_check","parked_drift_check","verification")

    $snapshot = Get-AgentOsGitSnapshot -RepositoryRoot $RepositoryRoot
    $staged = @($snapshot.entries | Where-Object Staged)

    if ($staged.Count -eq 0 -and -not $AllowNoStagedFiles) {
        throw "No staged files."
    }

    $mode = if ($staged.Count -eq 0) { "EVIDENCE_ONLY" } else { "SOURCE_CHANGE" }
    $classified = if ($staged.Count -eq 0) {
        @()
    } else {
        @(Get-AgentOsScopeClassification -RepositoryRoot $RepositoryRoot -Entries $staged -Task $task)
    }

    $invalid = @(
        $classified | Where-Object {
            $_.Classification -notin @("NEW_ALLOWED","PREEXISTING_ALLOWED")
        }
    )

    $status = if ($invalid.Count -eq 0) { "PASSED" } else { "FAILED" }
    $stat = (Invoke-AgentOsGit -RepositoryRoot $RepositoryRoot -Arguments @("diff","--cached","--stat")).Text
    $path = Join-Path $paths.EvidenceReview "commit-$($task.id)-$((Get-Date).ToString('yyyyMMdd-HHmmss')).json"

    Save-AgentOsJson -Value ([ordered]@{
        schema_version = "1.1"
        type = "commit-check"
        task_id = $task.id
        created_at = [DateTimeOffset]::Now.ToString("o")
        status = $status
        mode = $mode
        staged_files = $classified
        invalid_staged_files = $invalid
        staged_stat = $stat
    }) -Path $path

    $task.quality_gates.commit_check = $status
    $task.status = if ($status -eq "PASSED") { "READY_TO_COMMIT" } else { "BLOCKED" }
    $task.evidence = @($task.evidence) + @($path)
    Save-AgentOsTaskAndManifest -Paths $paths -Task $task

    [pscustomobject]@{
        Status = $status
        StagedFiles = $classified
        InvalidStagedFiles = $invalid
        StagedStat = $stat
        Evidence = $path
    }
}
