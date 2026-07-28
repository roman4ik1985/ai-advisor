function Initialize-AgentOs {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    Invoke-AgentOsTransactionalOperation -RepositoryRoot $RepositoryRoot -Operation "init" -ScriptBlock {
        Initialize-AgentOsCore -RepositoryRoot $RepositoryRoot
    }
}

function New-AgentOsTask {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$Goal,
        [Parameter(Mandatory)][string[]]$AllowedScope,
        [string[]]$ProtectedScope=@(),
        [string[]]$ParkedFiles=@(),
        [ValidateSet("LOW","MEDIUM","HIGH","CRITICAL")][string]$RiskLevel="MEDIUM",
        [switch]$AutoParkUnrelatedBaseline,
        [switch]$Force
    )
    Invoke-AgentOsTransactionalOperation -RepositoryRoot $RepositoryRoot -Operation "task-new" -Identity "$Title|$Goal" -Force:$Force -ScriptBlock {
        New-AgentOsTaskCore -RepositoryRoot $RepositoryRoot -Title $Title -Goal $Goal `
            -AllowedScope $AllowedScope -ProtectedScope $ProtectedScope -ParkedFiles $ParkedFiles `
            -RiskLevel $RiskLevel -AutoParkUnrelatedBaseline:$AutoParkUnrelatedBaseline -Force:$Force
    }
}

function Update-AgentOsTaskToV05 {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot,[switch]$Force)
    Invoke-AgentOsTransactionalOperation -RepositoryRoot $RepositoryRoot -Operation "task-migrate" -Force:$Force -ScriptBlock {
        Update-AgentOsTaskToV05Core -RepositoryRoot $RepositoryRoot
    }
}

function Add-AgentOsParkedFile {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot,[Parameter(Mandatory)][string[]]$Path,[string]$Reason="parked by user",[switch]$Force)
    Invoke-AgentOsTransactionalOperation -RepositoryRoot $RepositoryRoot -Operation "park-add" -Force:$Force -ScriptBlock {
        Add-AgentOsParkedFileCore -RepositoryRoot $RepositoryRoot -Path $Path -Reason $Reason
    }
}

function Remove-AgentOsParkedFile {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot,[Parameter(Mandatory)][string[]]$Path,[switch]$Force)
    Invoke-AgentOsTransactionalOperation -RepositoryRoot $RepositoryRoot -Operation "park-remove" -Force:$Force -ScriptBlock {
        Remove-AgentOsParkedFileCore -RepositoryRoot $RepositoryRoot -Path $Path -Force:$Force
    }
}

function Test-AgentOsScope {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot,[switch]$Force)
    Invoke-AgentOsTransactionalOperation -RepositoryRoot $RepositoryRoot -Operation "scope-check" -Force:$Force -ScriptBlock {
        Test-AgentOsScopeCore -RepositoryRoot $RepositoryRoot
    }
}

function Invoke-AgentOsVerification {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot,[Parameter(Mandatory)][string]$Profile,[switch]$Force)
    Invoke-AgentOsTransactionalOperation -RepositoryRoot $RepositoryRoot -Operation "verify" -Identity $Profile -Force:$Force -ScriptBlock {
        Invoke-AgentOsVerificationCore -RepositoryRoot $RepositoryRoot -Profile $Profile
    }
}

function New-AgentOsSavepoint {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot,[string]$Note,[switch]$Force)
    Invoke-AgentOsTransactionalOperation -RepositoryRoot $RepositoryRoot -Operation "savepoint-create" -Force:$Force -ScriptBlock {
        New-AgentOsSavepointCore -RepositoryRoot $RepositoryRoot -Note $Note
    }
}

function Test-AgentOsCommit {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot,[switch]$AllowNoStagedFiles,[switch]$Force)
    Invoke-AgentOsTransactionalOperation -RepositoryRoot $RepositoryRoot -Operation "commit-check" -Force:$Force -ScriptBlock {
        Test-AgentOsCommitCore -RepositoryRoot $RepositoryRoot -AllowNoStagedFiles:$AllowNoStagedFiles
    }
}

function Complete-AgentOsTask {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot,[Parameter(Mandatory)][string]$CommitHash,[switch]$EvidenceOnly,[switch]$Force)
    Invoke-AgentOsTransactionalOperation -RepositoryRoot $RepositoryRoot -Operation "task-complete" -Identity $CommitHash -Force:$Force -ScriptBlock {
        Complete-AgentOsTaskCore -RepositoryRoot $RepositoryRoot -CommitHash $CommitHash -EvidenceOnly:$EvidenceOnly
    }
}
function Set-AgentOsTaskPhase {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)]
        [ValidateSet("SCOPED","READY","IN_PROGRESS","VERIFYING","REVIEWING","READY_TO_COMMIT","BLOCKED","FAILED")]
        [string]$Phase,
        [string]$Note,
        [switch]$Force
    )

    Invoke-AgentOsTransactionalOperation `
        -RepositoryRoot $RepositoryRoot `
        -Operation "phase-set" `
        -Identity $Phase `
        -SkipLifecycleCheck `
        -Force:$Force `
        -ScriptBlock {
            Set-AgentOsTaskPhaseCore `
                -RepositoryRoot $RepositoryRoot `
                -Phase $Phase `
                -Note $Note
        }
}
