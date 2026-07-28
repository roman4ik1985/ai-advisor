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
            scope = @{
                allow_preexisting_allowed = $true
                allow_preexisting_parked = $true
                block_preexisting_unclassified = $true
                block_new_unexpected = $true
                block_protected = $true
            }
        } | ConvertTo-Json -Depth 10 |
            Set-Content -LiteralPath $paths.PolicyConfig -Encoding UTF8
    }

    [pscustomobject]@{
        Status = "INITIALIZED"
        Root   = $paths.Root
    }
}
