function Test-AgentOsScopeCore {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot
    $snapshot = Get-AgentOsGitSnapshot -RepositoryRoot $RepositoryRoot

    $classified = @(Get-AgentOsScopeClassification -RepositoryRoot $RepositoryRoot -Entries $snapshot.entries -Task $task)
    $gate = Test-AgentOsScopePass -Classified $classified
    $status = if ($gate.Passed) { "PASSED" } else { "FAILED" }

    $summary = [ordered]@{}
    foreach ($group in ($classified | Group-Object Classification)) {
        $summary[$group.Name] = $group.Count
    }

    $evidence = [ordered]@{
        schema_version = "1.1"
        type = "scope-check"
        task_id = $task.id
        created_at = [DateTimeOffset]::Now.ToString("o")
        status = $status
        summary = $summary
        files = $classified
        blocking = @($gate.Blocking)
    }

    $path = Join-Path $paths.EvidenceReview "scope-$($task.id)-$((Get-Date).ToString('yyyyMMdd-HHmmss')).json"
    Save-AgentOsJson -Value $evidence -Path $path

    $task.quality_gates.scope_check = $status
    $drift = @($classified | Where-Object Classification -eq "PARKED_DRIFT")
    $task.quality_gates.parked_drift_check = if ($drift.Count -eq 0) { "PASSED" } else { "FAILED" }
    $task.status = if ($status -eq "PASSED") { "READY" } else { "BLOCKED" }
    $task.evidence = @($task.evidence) + @($path)
    Save-AgentOsTaskAndManifest -Paths $paths -Task $task

    [pscustomobject]@{
        Status = $status
        Summary = $summary
        Files = $classified
        Blocking = @($gate.Blocking)
        Evidence = $path
    }
}
