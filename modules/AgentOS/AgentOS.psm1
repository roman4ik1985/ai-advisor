$privateFiles = Get-ChildItem -Path (Join-Path $PSScriptRoot "Private") -Filter "*.ps1" | Sort-Object Name
$publicFiles  = Get-ChildItem -Path (Join-Path $PSScriptRoot "Public")  -Filter "*.ps1" | Sort-Object Name

foreach ($file in @($privateFiles + $publicFiles)) {
    . $file.FullName
}

Export-ModuleMember -Function @(
    "Initialize-AgentOs",
    "New-AgentOsTask",
    "Get-AgentOsTask",
    "Get-AgentOsManifest",
    "Test-AgentOsManifest",
    "Add-AgentOsParkedFile",
    "Remove-AgentOsParkedFile",
    "Get-AgentOsParkedFile",
    "Test-AgentOsParkedDrift",
    "Test-AgentOsScope",
    "Invoke-AgentOsVerification",
    "New-AgentOsSavepoint",
    "Test-AgentOsCommit",
    "Complete-AgentOsTask",
    "Update-AgentOsTaskToV05",
    "Get-AgentOsSystemStatus",
    "Repair-AgentOsState",
    "Clear-AgentOsCompletedTransactions",
    "Set-AgentOsTaskPhase",
    "Invoke-AgentOsDoctor",
    "Test-AgentOsRelease",
    "Get-AgentOsAudit"
)
