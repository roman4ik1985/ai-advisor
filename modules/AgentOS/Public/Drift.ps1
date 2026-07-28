function Test-AgentOsParkedDrift {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    $task=Get-AgentOsTask $RepositoryRoot
    $snap=Get-AgentOsGitSnapshot $RepositoryRoot
    $c=@(Get-AgentOsScopeClassification $RepositoryRoot $snap.entries $task)
    $d=@($c|Where-Object Classification -eq 'PARKED_DRIFT')
    [pscustomobject]@{Status=if($d.Count -eq 0){'PASSED'}else{'FAILED'};Files=$d}
}
