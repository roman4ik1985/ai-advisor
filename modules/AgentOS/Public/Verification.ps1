function Invoke-AgentOsVerificationCore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Profile
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot

    Assert-AgentOsRequiredGates -Task $task -GateNames @("manifest_validation","scope_check","parked_drift_check")

    $profileConfig = Get-AgentOsVerificationProfile `
        -ConfigPath $paths.CommandsConfig `
        -Profile $Profile

    $mapping = @(
        @{ Name = "lint";      Command = $profileConfig.lint;      Output = $paths.EvidenceTests },
        @{ Name = "typecheck"; Command = $profileConfig.typecheck; Output = $paths.EvidenceTests },
        @{ Name = "test";      Command = $profileConfig.test;      Output = $paths.EvidenceTests },
        @{ Name = "build";     Command = $profileConfig.build;     Output = $paths.EvidenceBuild },
        @{ Name = "smoke";     Command = $profileConfig.smoke;     Output = $paths.EvidenceSmoke }
    )

    $results = @()

    foreach ($item in $mapping) {
        if (-not [string]::IsNullOrWhiteSpace([string]$item.Command)) {
            $results += Invoke-AgentOsLoggedCommand `
                -RepositoryRoot $RepositoryRoot `
                -Name $item.Name `
                -CommandText ([string]$item.Command) `
                -OutputDirectory ([string]$item.Output) `
                -TaskId $task.id
        }
    }

    if ($results.Count -eq 0) {
        throw "Verification profile '$Profile' has no commands."
    }

    $failed = @($results | Where-Object Status -eq "FAILED")
    $status = if ($failed.Count -eq 0) { "PASSED" } else { "FAILED" }

    $path = Join-Path $paths.Evidence "verification-$($task.id)-$((Get-Date).ToString('yyyyMMdd-HHmmss')).json"

    Save-AgentOsJson -Value ([ordered]@{
        schema_version = "1.1"
        type = "verification"
        task_id = $task.id
        profile = $Profile
        created_at = [DateTimeOffset]::Now.ToString("o")
        status = $status
        results = $results
    }) -Path $path

    $task.quality_gates.verification = $status
    $task.status = if ($status -eq "PASSED") { "REVIEWING" } else { "FAILED" }
    $task.evidence = @($task.evidence) + @($path)
    Save-AgentOsTaskAndManifest -Paths $paths -Task $task

    [pscustomobject]@{
        Status = $status
        Profile = $Profile
        Results = $results
        Evidence = $path
    }
}
