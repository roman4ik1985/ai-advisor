function Save-AgentOsJsonRaw {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string]$Path
    )

    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temporary = "$Path.$PID.tmp"
    $Value | ConvertTo-Json -Depth 60 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Read-AgentOsJsonRaw {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Save-AgentOsJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string]$Path
    )
    Register-AgentOsTransactionalWrite -Path $Path
    Save-AgentOsJsonRaw -Value $Value -Path $Path
}

function Read-AgentOsJson {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)
    Read-AgentOsJsonRaw -Path $Path
}
