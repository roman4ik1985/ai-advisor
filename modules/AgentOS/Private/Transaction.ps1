$script:AgentOsCurrentTransaction = $null

function Test-AgentOsProcessAlive {
    [CmdletBinding()]
    param([Parameter(Mandatory)][int]$ProcessId)

    try {
        $null = Get-Process -Id $ProcessId -ErrorAction Stop
        $true
    }
    catch { $false }
}

function Enter-AgentOsLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Paths,
        [Parameter(Mandatory)][string]$Operation,
        [switch]$Force
    )

    if (Test-Path -LiteralPath $Paths.LockFile) {
        $lock = Read-AgentOsJsonRaw -Path $Paths.LockFile
        $alive = $false
        if ($lock -and $lock.process_id) {
            $alive = Test-AgentOsProcessAlive -ProcessId ([int]$lock.process_id)
        }

        if ($alive -and -not $Force) {
            throw "Agent OS is locked by PID $($lock.process_id): $($lock.operation)."
        }

        if (-not $Force) {
            throw "Agent OS has an orphan lock. Run system recover or retry with -Force."
        }
    }

    Save-AgentOsJsonRaw -Value ([ordered]@{
        schema_version = "1.0"
        process_id = $PID
        operation = $Operation
        created_at = [DateTimeOffset]::Now.ToString("o")
        machine = $env:COMPUTERNAME
        user = $env:USERNAME
    }) -Path $Paths.LockFile
}

function Exit-AgentOsLock {
    [CmdletBinding()]
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Paths)

    if (Test-Path -LiteralPath $Paths.LockFile) {
        Remove-Item -LiteralPath $Paths.LockFile -Force
    }
}

function New-AgentOsTransaction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Paths,
        [Parameter(Mandatory)][string]$Operation
    )

    $id = "TX-$((Get-Date).ToString('yyyyMMdd-HHmmss-fff'))-$PID"
    $path = Join-Path $Paths.Transactions "$id.json"
    $data = [ordered]@{
        schema_version = "1.0"
        id = $id
        operation = $Operation
        process_id = $PID
        started_at = [DateTimeOffset]::Now.ToString("o")
        completed_at = $null
        status = "STARTED"
        backups = @()
        created_files = @()
        error = $null
    }
    Save-AgentOsJsonRaw -Value $data -Path $path
    [pscustomobject]@{ Id=$id; Path=$path; Paths=$Paths }
}

function Update-AgentOsTransaction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Transaction,
        [Parameter(Mandatory)]$Data
    )
    Save-AgentOsJsonRaw -Value $Data -Path $Transaction.Path
}

function Register-AgentOsTransactionalWrite {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $tx = $script:AgentOsCurrentTransaction
    if ($null -eq $tx) { return }

    $full = [IO.Path]::GetFullPath($Path)
    $txRoot = [IO.Path]::GetFullPath($tx.Paths.Transactions)
    $recoveryRoot = [IO.Path]::GetFullPath($tx.Paths.Recovery)
    $lockPath = [IO.Path]::GetFullPath($tx.Paths.LockFile)

    if ($full.StartsWith($txRoot,[StringComparison]::OrdinalIgnoreCase) -or
        $full.StartsWith($recoveryRoot,[StringComparison]::OrdinalIgnoreCase) -or
        $full -eq $lockPath) { return }

    $data = Read-AgentOsJsonRaw -Path $tx.Path
    $already = @($data.backups | Where-Object original -eq $full).Count -gt 0
    $created = @($data.created_files | Where-Object { $_ -eq $full }).Count -gt 0
    if ($already -or $created) { return }

    if (Test-Path -LiteralPath $full) {
        $safeName = ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($full))).TrimEnd('=').Replace('/','_').Replace('+','-')
        $backup = Join-Path $tx.Paths.Recovery "$($tx.Id)-$safeName.bak"
        Copy-Item -LiteralPath $full -Destination $backup -Force
        $data.backups = @($data.backups) + @([ordered]@{ original=$full; backup=$backup })
    }
    else {
        $data.created_files = @($data.created_files) + @($full)
    }
    Update-AgentOsTransaction -Transaction $tx -Data $data
}

function Remove-AgentOsTransactionalFile {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    Register-AgentOsTransactionalWrite -Path $Path
    Remove-Item -LiteralPath $Path -Force
}

function Undo-AgentOsTransaction {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$TransactionData)

    foreach ($path in @($TransactionData.created_files)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    foreach ($item in @($TransactionData.backups)) {
        if (Test-Path -LiteralPath $item.backup) {
            Copy-Item -LiteralPath $item.backup -Destination $item.original -Force
        }
    }
}

function Get-AgentOsOperationKey {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Operation,
        [string]$Identity
    )

    $material = "$([IO.Path]::GetFullPath($RepositoryRoot).ToLowerInvariant())|$Operation|$Identity"
    $bytes = [Text.Encoding]::UTF8.GetBytes($material)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-","").ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Invoke-AgentOsTransactionalOperation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Operation,
        [Parameter(Mandatory)][scriptblock]$ScriptBlock,
        [string]$Identity,
        [switch]$Force,
        [switch]$SkipLifecycleCheck
    )

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    Initialize-AgentOsDirectories -Paths $paths

    if (-not $SkipLifecycleCheck) {
        Assert-AgentOsOperationAllowed `
            -RepositoryRoot $RepositoryRoot `
            -Operation $Operation `
            -AllowMissingTask:($Operation -in @("init","task-new"))
    }

    $operationKey = Get-AgentOsOperationKey `
        -RepositoryRoot $RepositoryRoot `
        -Operation $Operation `
        -Identity $Identity

    Enter-AgentOsLock -Paths $paths -Operation $Operation -Force:$Force
    $tx = New-AgentOsTransaction -Paths $paths -Operation $Operation
    $script:AgentOsCurrentTransaction = $tx

    $txData = Read-AgentOsJsonRaw -Path $tx.Path
    $txData | Add-Member -NotePropertyName operation_key -NotePropertyValue $operationKey -Force
    $txData | Add-Member -NotePropertyName identity -NotePropertyValue $Identity -Force
    Update-AgentOsTransaction -Transaction $tx -Data $txData

    $taskId = $null
    try {
        try { $taskId = (Get-AgentOsTask -RepositoryRoot $RepositoryRoot).id } catch {}

        Write-AgentOsAuditEvent `
            -RepositoryRoot $RepositoryRoot `
            -Operation $Operation `
            -Status "STARTED" `
            -TaskId $taskId `
            -TransactionId $tx.Id `
            -Detail $Identity

        $result = & $ScriptBlock

        $data = Read-AgentOsJsonRaw -Path $tx.Path
        $data.status = "COMPLETED"
        $data.completed_at = [DateTimeOffset]::Now.ToString("o")
        Update-AgentOsTransaction -Transaction $tx -Data $data

        Write-AgentOsAuditEvent `
            -RepositoryRoot $RepositoryRoot `
            -Operation $Operation `
            -Status "COMPLETED" `
            -TaskId $taskId `
            -TransactionId $tx.Id `
            -Detail $Identity

        $result
    }
    catch {
        $data = Read-AgentOsJsonRaw -Path $tx.Path
        Undo-AgentOsTransaction -TransactionData $data
        $data.status = "ROLLED_BACK"
        $data.completed_at = [DateTimeOffset]::Now.ToString("o")
        $data.error = $_.Exception.Message
        Update-AgentOsTransaction -Transaction $tx -Data $data

        Write-AgentOsAuditEvent `
            -RepositoryRoot $RepositoryRoot `
            -Operation $Operation `
            -Status "ROLLED_BACK" `
            -TaskId $taskId `
            -TransactionId $tx.Id `
            -Detail $_.Exception.Message

        throw
    }
    finally {
        $script:AgentOsCurrentTransaction = $null
        Exit-AgentOsLock -Paths $paths
    }
}
