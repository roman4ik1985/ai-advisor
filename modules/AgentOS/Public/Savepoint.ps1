function New-AgentOsSavepointCore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [string]$Note
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot
    $snapshot = Get-AgentOsGitSnapshot -RepositoryRoot $RepositoryRoot
    $classified = @(Get-AgentOsScopeClassification -RepositoryRoot $RepositoryRoot -Entries $snapshot.entries -Task $task)

    $id = "SP-$((Get-Date).ToString('yyyy-MM-dd-HHmmss'))"
    $path = Join-Path $paths.Savepoints "$id-$($task.id).json"

    Save-AgentOsJson -Value ([ordered]@{
        schema_version = "1.1"
        id = $id
        created_at = [DateTimeOffset]::Now.ToString("o")
        task_id = $task.id
        manifest_path = $task.manifest_path
        task = $task
        repository = $snapshot
        files = $classified
        note = $Note
    }) -Path $path

    $task.notes = @($task.notes) + @(
        [ordered]@{
            type = "savepoint"
            created_at = [DateTimeOffset]::Now.ToString("o")
            path = $path
            note = $Note
        }
    )

    Save-AgentOsTaskAndManifest -Paths $paths -Task $task

    [pscustomobject]@{
        Status = "CREATED"
        Id = $id
        Path = $path
    }
}
