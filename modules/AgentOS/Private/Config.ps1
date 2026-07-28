function Get-AgentOsVerificationProfile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ConfigPath,
        [Parameter(Mandatory)][string]$Profile
    )

    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        throw "Verification config not found: $ConfigPath"
    }

    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $property = $config.verification_profiles.PSObject.Properties[$Profile]

    if ($null -eq $property) {
        $available = @($config.verification_profiles.PSObject.Properties.Name) -join ", "
        throw "Unknown verification profile '$Profile'. Available: $available"
    }

    $property.Value
}

function Assert-AgentOsPolicyPropertySet {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string[]]$Expected
    )

    $actual = @($Value.PSObject.Properties.Name)
    $missing = @($Expected | Where-Object { $_ -notin $actual })
    $unknown = @($actual | Where-Object { $_ -notin $Expected })

    if ($missing.Count -gt 0 -or $unknown.Count -gt 0) {
        $parts = @()
        if ($missing.Count -gt 0) { $parts += "missing: $($missing -join ', ')" }
        if ($unknown.Count -gt 0) { $parts += "unsupported: $($unknown -join ', ')" }
        throw "Invalid policy '$Name' properties ($($parts -join '; '))."
    }
}

function Get-AgentOsPolicy {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    if (-not (Test-Path -LiteralPath $paths.PolicyConfig -PathType Leaf)) {
        throw "Policy config not found: $($paths.PolicyConfig)"
    }

    try {
        $policy = Get-Content -LiteralPath $paths.PolicyConfig -Raw | ConvertFrom-Json
    }
    catch {
        throw "Policy config is not valid JSON: $($_.Exception.Message)"
    }

    Assert-AgentOsPolicyPropertySet -Value $policy -Name 'root' -Expected @(
        'schema_version', 'parked_files', 'commit', 'transactions', 'lifecycle', 'audit'
    )
    if ([string]$policy.schema_version -ne '1.0') {
        throw "Unsupported policy schema_version '$($policy.schema_version)'. Expected 1.0."
    }

    Assert-AgentOsPolicyPropertySet -Value $policy.parked_files -Name 'parked_files' -Expected @(
        'immutable_during_task', 'fingerprint_algorithm', 'block_on_drift'
    )
    Assert-AgentOsPolicyPropertySet -Value $policy.commit -Name 'commit' -Expected @('allowed_classes')
    Assert-AgentOsPolicyPropertySet -Value $policy.transactions -Name 'transactions' -Expected @('lock_timeout_minutes')
    Assert-AgentOsPolicyPropertySet -Value $policy.lifecycle -Name 'lifecycle' -Expected @(
        'strict_operation_phases', 'strict_phase_transitions', 'completion_idempotent_by_commit'
    )
    Assert-AgentOsPolicyPropertySet -Value $policy.audit -Name 'audit' -Expected @('format', 'retain_days')

    if ($policy.parked_files.immutable_during_task -isnot [bool] -or $policy.parked_files.block_on_drift -isnot [bool]) {
        throw 'Policy parked_files boolean values are invalid.'
    }
    if ([string]$policy.parked_files.fingerprint_algorithm -ne 'SHA256') {
        throw "Unsupported fingerprint algorithm '$($policy.parked_files.fingerprint_algorithm)'. Expected SHA256."
    }
    $allowedClasses = @($policy.commit.allowed_classes | ForEach-Object { [string]$_ })
    if ($allowedClasses.Count -eq 0 -or @($allowedClasses | Where-Object { $_ -notin @('NEW_ALLOWED', 'PREEXISTING_ALLOWED') }).Count -gt 0) {
        throw 'Policy commit.allowed_classes must contain only NEW_ALLOWED and PREEXISTING_ALLOWED.'
    }
    $lockTimeout = 0
    if (-not [int]::TryParse([string]$policy.transactions.lock_timeout_minutes, [ref]$lockTimeout) -or $lockTimeout -lt 1 -or $lockTimeout -gt 1440) {
        throw 'Policy transactions.lock_timeout_minutes must be an integer from 1 through 1440.'
    }
    if ($policy.lifecycle.strict_operation_phases -ne $true -or
        $policy.lifecycle.strict_phase_transitions -ne $true -or
        $policy.lifecycle.completion_idempotent_by_commit -ne $true) {
        throw 'Agent OS 1.0 requires strict lifecycle operation and phase checks.'
    }
    if ([string]$policy.audit.format -ne 'jsonl') {
        throw "Unsupported audit format '$($policy.audit.format)'. Expected jsonl."
    }
    $retainDays = 0
    if (-not [int]::TryParse([string]$policy.audit.retain_days, [ref]$retainDays) -or $retainDays -lt 1 -or $retainDays -gt 3650) {
        throw 'Policy audit.retain_days must be an integer from 1 through 3650.'
    }

    $policy
}
