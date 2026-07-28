function Complete-AgentOsTaskCore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$CommitHash,
        [switch]$EvidenceOnly
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot

    if (-not (Test-Path -LiteralPath $paths.CurrentTask)) {
        $existing = @(
            Get-ChildItem -LiteralPath $paths.TasksCompleted -Filter "*-completion.json" -ErrorAction SilentlyContinue |
                ForEach-Object { Read-AgentOsJson -Path $_.FullName } |
                Where-Object { [string]$_.commit.hash -eq $CommitHash }
        )

        if ($existing.Count -gt 0) {
            return [pscustomobject]@{
                Status = "ALREADY_COMPLETED"
                TaskId = $existing[0].task_id
                CommitHash = $CommitHash
            }
        }
    }

    $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot
    $policy = Get-AgentOsPolicy -RepositoryRoot $RepositoryRoot

    Assert-AgentOsRequiredGates -Task $task -GateNames @("manifest_validation","scope_check","parked_drift_check","verification","commit_check")

    $verifyCommit = Invoke-AgentOsGit `
        -RepositoryRoot $RepositoryRoot `
        -Arguments @("cat-file","-e","$CommitHash^{commit}") `
        -AllowFailure

    if ($verifyCommit.ExitCode -ne 0) {
        throw "Commit '$CommitHash' does not exist."
    }

    if ($EvidenceOnly) {
        if ($CommitHash -ne [string]$task.baseline.head) {
            throw "Evidence-only completion must use the task baseline commit."
        }
        $commitCheckEvidence = @($task.evidence | ForEach-Object { Read-AgentOsJson -Path $_ }) |
            Where-Object { $_.type -eq "commit-check" -and $_.status -eq "PASSED" -and $_.mode -eq "EVIDENCE_ONLY" }
        if ($commitCheckEvidence.Count -eq 0) {
            throw "Evidence-only completion requires a successful commit check with -AllowNoStagedFiles."
        }
        $entries = @()
        $completionMode = "EVIDENCE_ONLY"
    } else {
        $filesResult = Invoke-AgentOsGit `
            -RepositoryRoot $RepositoryRoot `
            -Arguments @("diff-tree","--no-commit-id","--name-only","-r",$CommitHash)
        $entries = @(
            $filesResult.Output |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
                ForEach-Object {
                    [pscustomobject]@{
                        Code = "C "
                        Path = ([string]$_).Replace("\","/")
                        Staged = $false
                        Worktree = $false
                        Untracked = $false
                    }
                }
        )
        $completionMode = "SOURCE_CHANGE"
    }

    $classified = if ($entries.Count -eq 0) {
        @()
    } else {
        @(Get-AgentOsScopeClassification -RepositoryRoot $RepositoryRoot -Entries $entries -Task $task)
    }
    $invalid = @(
        $classified | Where-Object {
            $_.Classification -notin @($policy.commit.allowed_classes)
        }
    )

    if ($invalid.Count -gt 0) {
        throw "Commit contains files outside allowed scope."
    }

    $snapshot = Get-AgentOsGitSnapshot -RepositoryRoot $RepositoryRoot
    $completionPath = Join-Path $paths.TasksCompleted "$($task.id)-completion.json"

    Save-AgentOsJson -Value ([ordered]@{
        schema_version = "1.1"
        task_id = $task.id
        completed_at = [DateTimeOffset]::Now.ToString("o")
        final_status = "COMPLETED"
        title = $task.title
        goal = $task.goal
        manifest_path = $task.manifest_path
        commit = [ordered]@{
            hash = $CommitHash
            mode = $completionMode
            files = $classified
        }
        parked_files_preserved = @($task.parked_files)
        quality_gates = $task.quality_gates
        evidence = $task.evidence
        repository_after = $snapshot
    }) -Path $completionPath

    $manifest = Read-AgentOsJson -Path $task.manifest_path
    $manifest.status.phase = "COMPLETED"
    $manifest.status.quality_gates.completion = "PASSED"
    Save-AgentOsJson -Value $manifest -Path $task.manifest_path

    $activePath = Join-Path $paths.TasksActive "$($task.id).json"
    if (Test-Path -LiteralPath $activePath) { Remove-AgentOsTransactionalFile -Path $activePath }
    if (Test-Path -LiteralPath $paths.CurrentTask) { Remove-AgentOsTransactionalFile -Path $paths.CurrentTask }

    [pscustomobject]@{
        Status = "COMPLETED"
        TaskId = $task.id
        CompletionRecord = $completionPath
    }
}
