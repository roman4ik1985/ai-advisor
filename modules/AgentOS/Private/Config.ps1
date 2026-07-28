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
