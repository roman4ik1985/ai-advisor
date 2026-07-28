function Get-AgentOsSystemStatus {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    Initialize-AgentOsDirectories -Paths $paths
    $lock = Read-AgentOsJsonRaw -Path $paths.LockFile
    $transactions = @(
        Get-ChildItem -LiteralPath $paths.Transactions -Filter "*.json" -ErrorAction SilentlyContinue |
            ForEach-Object { Read-AgentOsJsonRaw -Path $_.FullName }
    )
    [pscustomobject]@{
        Lock = $lock
        Started = @($transactions | Where-Object status -eq "STARTED")
        RolledBack = @($transactions | Where-Object status -eq "ROLLED_BACK")
        Failed = @($transactions | Where-Object status -eq "FAILED")
    }
}

function Repair-AgentOsState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [switch]$Force
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    Initialize-AgentOsDirectories -Paths $paths
    $recovered = @()
    $orphanedTasks = @()

    foreach ($file in Get-ChildItem -LiteralPath $paths.Transactions -Filter "*.json" -ErrorAction SilentlyContinue) {
        $tx = Read-AgentOsJsonRaw -Path $file.FullName
        if ($tx.status -ne "STARTED") { continue }

        if ((Test-AgentOsProcessAlive -ProcessId ([int]$tx.process_id)) -and -not $Force) {
            throw "Transaction '$($tx.id)' belongs to a live process."
        }

        Undo-AgentOsTransaction -TransactionData $tx
        $tx.status = "ROLLED_BACK"
        $tx.completed_at = [DateTimeOffset]::Now.ToString("o")
        $tx.error = "Recovered after interrupted operation."
        Save-AgentOsJsonRaw -Value $tx -Path $file.FullName
        $recovered += $tx.id
    }

    $currentTask = Read-AgentOsJsonRaw -Path $paths.CurrentTask
    $currentActiveName = if ($currentTask -and $currentTask.id) { "$($currentTask.id).json" } else { $null }
    foreach ($file in Get-ChildItem -LiteralPath $paths.TasksActive -Filter "*.json" -ErrorAction SilentlyContinue) {
        if ($file.Name -eq $currentActiveName) { continue }

        $recoveryPath = Join-Path $paths.Recovery "orphan-active-$($file.Name)"
        Move-Item -LiteralPath $file.FullName -Destination $recoveryPath -Force
        $orphanedTasks += $file.Name
    }

    Exit-AgentOsLock -Paths $paths
    [pscustomobject]@{ Status="RECOVERED"; Transactions=$recovered; OrphanedTasks=$orphanedTasks }
}

function Clear-AgentOsCompletedTransactions {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [int]$OlderThanDays = 0
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    $policy = Get-AgentOsPolicy -RepositoryRoot $RepositoryRoot
    if ($OlderThanDays -le 0) { $OlderThanDays = [int]$policy.audit.retain_days }
    $cutoff = [DateTimeOffset]::Now.AddDays(-$OlderThanDays)
    $removed = @()
    foreach ($file in Get-ChildItem -LiteralPath $paths.Transactions -Filter "*.json" -ErrorAction SilentlyContinue) {
        $tx = Read-AgentOsJsonRaw -Path $file.FullName
        if ($tx.status -in @("COMPLETED","ROLLED_BACK") -and $tx.completed_at -and
            [DateTimeOffset]::Parse([string]$tx.completed_at) -lt $cutoff) {
            Remove-Item -LiteralPath $file.FullName -Force
            $removed += $file.Name
        }
    }
    $auditPath = Join-Path $paths.Logs 'audit.jsonl'
    $retainedAudit = 0
    $removedAudit = 0
    if (Test-Path -LiteralPath $auditPath -PathType Leaf) {
        $retained = @()
        foreach ($line in @(Get-Content -LiteralPath $auditPath)) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try {
                $event = $line | ConvertFrom-Json
                $recordedAt = [DateTimeOffset]::Parse([string]$event.recorded_at)
                if ($recordedAt -ge $cutoff) {
                    $retained += $line
                    $retainedAudit++
                }
                else {
                    $removedAudit++
                }
            }
            catch {
                throw "Audit log contains invalid JSONL: $($_.Exception.Message)"
            }
        }
        Set-Content -LiteralPath $auditPath -Value $retained -Encoding UTF8
    }

    [pscustomobject]@{ Status="CLEANED"; Removed=$removed; RetainedAudit=$retainedAudit; RemovedAudit=$removedAudit }
}
