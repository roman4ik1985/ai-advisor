@{
    RootModule        = "AgentOS.psm1"
    ModuleVersion     = "1.0.0"
    GUID              = "4c945193-10ad-42c8-9af2-561b3f84da91"
    Author            = "my-erp-system"
    CompanyName       = "Local"
    Description       = "Agent OS integration release with fingerprint baselines, transactional writes and recovery."
    PowerShellVersion = "5.1"

    FunctionsToExport = @(
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

    CmdletsToExport   = @()
    VariablesToExport = @()
    AliasesToExport   = @()
}
