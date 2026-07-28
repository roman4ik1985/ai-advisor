function Save-AgentOsTaskAndManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Paths,
        [Parameter(Mandatory)]$Task
    )

    $Task.updated_at = [DateTimeOffset]::Now.ToString("o")
    Save-AgentOsJson -Value $Task -Path $Paths.CurrentTask
    Save-AgentOsJson -Value $Task -Path (Join-Path $Paths.TasksActive "$($Task.id).json")

    if ($Task.manifest_path -and (Test-Path -LiteralPath $Task.manifest_path)) {
        $manifest = Read-AgentOsJson -Path $Task.manifest_path
        $manifest = Update-AgentOsManifestFromTask -Manifest $manifest -Task $Task
        Save-AgentOsJson -Value $manifest -Path $Task.manifest_path
    }
}
