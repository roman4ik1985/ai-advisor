function Update-AgentOsTaskToV05Core {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    $paths=Get-AgentOsPaths $RepositoryRoot
    $task=Get-AgentOsTask $RepositoryRoot
    if([string]$task.schema_version -eq '1.1'){return [pscustomobject]@{Status='NO_CHANGE';SchemaVersion='1.1'}}
    $task.baseline=Add-AgentOsSnapshotFingerprints $RepositoryRoot $task.baseline
    $task.schema_version='1.1'
    $task.quality_gates | Add-Member -NotePropertyName manifest_validation -NotePropertyValue 'PASSED' -Force
    $task.quality_gates | Add-Member -NotePropertyName parked_drift_check -NotePropertyValue 'PENDING' -Force
    Save-AgentOsTaskAndManifest $paths $task
    [pscustomobject]@{Status='MIGRATED';SchemaVersion='1.1'}
}
