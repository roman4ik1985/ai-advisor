function New-AgentOsManifestObject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$TaskId,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$Goal,
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)]$Baseline,
        [Parameter(Mandatory)][string[]]$AllowedScope,
        [AllowEmptyCollection()][string[]]$ProtectedScope = @(),
        [AllowEmptyCollection()][object[]]$ParkedFiles = @(),
        [Parameter(Mandatory)][string]$RiskLevel
    )

    [ordered]@{
        schema_version = "1.1"
        kind           = "agent-os-task-manifest"
        metadata       = [ordered]@{
            id         = $TaskId
            title      = $Title
            created_at = [DateTimeOffset]::Now.ToString("o")
        }
        spec           = [ordered]@{
            goal            = $Goal
            risk_level      = $RiskLevel
            repository_root = $RepositoryRoot
            allowed_scope   = @($AllowedScope)
            protected_scope = @($ProtectedScope)
            parked_files    = @($ParkedFiles)
            baseline        = $Baseline
            required_gates  = @(
                "manifest_validation",
                "scope_check",
                "parked_drift_check",
                "verification",
                "commit_check"
            )
        }
        status         = [ordered]@{
            phase         = "SCOPED"
            quality_gates = [ordered]@{
                manifest_validation = "PASSED"
                scope_check  = "PENDING"
                parked_drift_check = "PENDING"
                verification = "PENDING"
                commit_check = "PENDING"
                completion   = "PENDING"
            }
            evidence = @()
            notes    = @()
        }
    }
}

function Convert-AgentOsManifestToTaskState {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Manifest)

    [ordered]@{
        schema_version = $Manifest.schema_version
        id             = $Manifest.metadata.id
        title          = $Manifest.metadata.title
        goal           = $Manifest.spec.goal
        status         = $Manifest.status.phase
        risk_level     = $Manifest.spec.risk_level
        created_at     = $Manifest.metadata.created_at
        updated_at     = [DateTimeOffset]::Now.ToString("o")
        repository     = [ordered]@{
            root         = $Manifest.spec.repository_root
            branch       = $Manifest.spec.baseline.branch
            initial_head = $Manifest.spec.baseline.head
        }
        allowed_scope   = @($Manifest.spec.allowed_scope)
        protected_scope = @($Manifest.spec.protected_scope)
        parked_files    = @($Manifest.spec.parked_files)
        baseline        = $Manifest.spec.baseline
        required_gates  = @($Manifest.spec.required_gates)
        quality_gates   = $Manifest.status.quality_gates
        evidence        = @($Manifest.status.evidence)
        notes           = @($Manifest.status.notes)
        manifest_path   = $null
    }
}

function Update-AgentOsManifestFromTask {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Manifest,
        [Parameter(Mandatory)]$Task
    )

    $Manifest.status.phase = $Task.status
    $Manifest.status.quality_gates = $Task.quality_gates
    $Manifest.status.evidence = @($Task.evidence)
    $Manifest.status.notes = @($Task.notes)
    $Manifest.spec.parked_files = @($Task.parked_files)
    $Manifest
}


function Test-AgentOsManifestObject {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Manifest)
    $errors=@()
    if([string]$Manifest.schema_version -ne '1.1'){$errors+='schema_version must be 1.1'}
    if([string]$Manifest.kind -ne 'agent-os-task-manifest'){$errors+='kind must be agent-os-task-manifest'}
    foreach($name in @('id','title','created_at')){if([string]::IsNullOrWhiteSpace([string]$Manifest.metadata.$name)){$errors+="metadata.$name is required"}}
    if([string]::IsNullOrWhiteSpace([string]$Manifest.spec.goal)){$errors+='spec.goal is required'}
    if(@($Manifest.spec.allowed_scope).Count -eq 0){$errors+='spec.allowed_scope must not be empty'}
    foreach($e in @($Manifest.spec.baseline.entries)){if($null -eq $e.fingerprint){$errors+="baseline entry '$($e.Path)' has no fingerprint"}}
    [pscustomobject]@{Valid=($errors.Count -eq 0);Errors=$errors}
}
