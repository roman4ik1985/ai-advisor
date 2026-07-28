function Initialize-AgentOsCore {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    Initialize-AgentOsDirectories -Paths $paths

    if (-not (Test-Path -LiteralPath $paths.CommandsConfig)) {
        @{
            schema_version = "1.0"
            verification_profiles = @{
                default = @{
                    lint = $null
                    typecheck = $null
                    test = $null
                    build = $null
                    smoke = $null
                }
            }
        } | ConvertTo-Json -Depth 10 |
            Set-Content -LiteralPath $paths.CommandsConfig -Encoding UTF8
    }

    if (-not (Test-Path -LiteralPath $paths.PolicyConfig)) {
        @{
            schema_version = "1.0"
            parked_files = @{
                immutable_during_task = $true
                fingerprint_algorithm = "SHA256"
                block_on_drift = $true
            }
            commit = @{
                allowed_classes = @("NEW_ALLOWED", "PREEXISTING_ALLOWED")
            }
            transactions = @{
                lock_timeout_minutes = 30
            }
            lifecycle = @{
                strict_operation_phases = $true
                strict_phase_transitions = $true
                completion_idempotent_by_commit = $true
            }
            audit = @{
                format = "jsonl"
                retain_days = 90
            }
        } | ConvertTo-Json -Depth 10 |
            Set-Content -LiteralPath $paths.PolicyConfig -Encoding UTF8
    }

    [pscustomobject]@{
        Status = "INITIALIZED"
        Root   = $paths.Root
    }
}
