function Write-AgentOsAuditEvent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Operation,
        [Parameter(Mandatory)][string]$Status,
        [string]$TaskId,
        [string]$TransactionId,
        [string]$Detail
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $auditPath = Join-Path $paths.Logs "audit.jsonl"

    $event = [ordered]@{
        schema_version = "1.0"
        recorded_at    = [DateTimeOffset]::Now.ToString("o")
        operation      = $Operation
        status         = $Status
        task_id        = $TaskId
        transaction_id = $TransactionId
        process_id     = $PID
        machine        = $env:COMPUTERNAME
        user           = $env:USERNAME
        detail         = $Detail
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $auditPath) -Force | Out-Null
    ($event | ConvertTo-Json -Compress -Depth 20) |
        Add-Content -LiteralPath $auditPath -Encoding UTF8
}

function Read-AgentOsAuditEvent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [int]$Last = 50
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $auditPath = Join-Path $paths.Logs "audit.jsonl"
    if (-not (Test-Path -LiteralPath $auditPath)) { return @() }

    @(
        Get-Content -LiteralPath $auditPath |
            Select-Object -Last $Last |
            ForEach-Object { $_ | ConvertFrom-Json }
    )
}
