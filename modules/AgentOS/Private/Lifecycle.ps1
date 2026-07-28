$script:AgentOsOperationPolicy = @{
    "park-add"         = @("SCOPED","READY","IN_PROGRESS","BLOCKED")
    "park-remove"      = @("SCOPED","READY","IN_PROGRESS","BLOCKED")
    "scope-check"      = @("SCOPED","READY","IN_PROGRESS","BLOCKED","FAILED","REVIEWING","READY_TO_COMMIT")
    "verify"           = @("READY","REVIEWING","FAILED")
    "savepoint-create" = @("SCOPED","READY","IN_PROGRESS","BLOCKED","FAILED","REVIEWING","READY_TO_COMMIT")
    "commit-check"     = @("REVIEWING","READY_TO_COMMIT","BLOCKED")
    "task-complete"    = @("READY_TO_COMMIT")
    "task-migrate"     = @("SCOPED","READY","IN_PROGRESS","BLOCKED","FAILED","REVIEWING","READY_TO_COMMIT")
}

$script:AgentOsPhaseTransitions = @{
    "SCOPED"          = @("READY","IN_PROGRESS","BLOCKED","FAILED")
    "READY"           = @("IN_PROGRESS","VERIFYING","BLOCKED","FAILED")
    "IN_PROGRESS"     = @("READY","VERIFYING","BLOCKED","FAILED")
    "VERIFYING"       = @("REVIEWING","FAILED","BLOCKED")
    "REVIEWING"       = @("READY_TO_COMMIT","IN_PROGRESS","FAILED","BLOCKED")
    "READY_TO_COMMIT" = @("COMPLETED","IN_PROGRESS","BLOCKED","FAILED")
    "BLOCKED"         = @("SCOPED","READY","IN_PROGRESS","FAILED")
    "FAILED"          = @("SCOPED","READY","IN_PROGRESS","BLOCKED")
    "COMPLETED"       = @()
}

function Assert-AgentOsOperationAllowed {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Operation,
        [switch]$AllowMissingTask
    )

    if (-not $script:AgentOsOperationPolicy.ContainsKey($Operation)) {
        return
    }

    try {
        $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot
    }
    catch {
        if ($AllowMissingTask) { return }
        throw
    }

    $allowed = @($script:AgentOsOperationPolicy[$Operation])
    if ([string]$task.status -notin $allowed) {
        throw "Operation '$Operation' is not allowed while task phase is '$($task.status)'. Allowed phases: $($allowed -join ', ')."
    }
}

function Test-AgentOsPhaseTransition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$From,
        [Parameter(Mandatory)][string]$To
    )

    if ($From -eq $To) {
        return [pscustomobject]@{ Allowed=$true; Idempotent=$true; Reason="Phase already set." }
    }

    if (-not $script:AgentOsPhaseTransitions.ContainsKey($From)) {
        return [pscustomobject]@{ Allowed=$false; Idempotent=$false; Reason="Unknown source phase '$From'." }
    }

    $allowed = @($script:AgentOsPhaseTransitions[$From])
    [pscustomobject]@{
        Allowed    = ($To -in $allowed)
        Idempotent = $false
        Reason     = if ($To -in $allowed) { "Allowed transition." } else { "Allowed targets: $($allowed -join ', ')." }
    }
}

function Assert-AgentOsRequiredGates {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Task,
        [Parameter(Mandatory)][string[]]$GateNames
    )

    foreach ($name in $GateNames) {
        if ($null -eq $Task.quality_gates.PSObject.Properties[$name]) {
            throw "Required gate '$name' is missing."
        }
        if ([string]$Task.quality_gates.$name -ne "PASSED") {
            throw "Required gate '$name' is '$($Task.quality_gates.$name)', expected PASSED."
        }
    }
}
