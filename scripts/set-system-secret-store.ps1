[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string[]]$Set,
  [string]$Path,
  [switch]$Initialize,
  [switch]$AllowTelegramEnabled
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'system-secret-store.ps1')

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'SYSTEM_SECRET_PROVISIONING_REQUIRES_ADMINISTRATOR'
}

$storePath = if ([string]::IsNullOrWhiteSpace($Path)) {
  Get-SystemSecretStorePath
} else {
  [IO.Path]::GetFullPath($Path)
}
$exists = Test-Path -LiteralPath $storePath
if ($Initialize -and $exists) {
  throw 'SYSTEM_SECRET_STORE_ALREADY_EXISTS'
}
if (-not $Initialize -and -not $exists) {
  throw 'SYSTEM_SECRET_STORE_NOT_FOUND_USE_INITIALIZE'
}

$values = if ($exists) {
  Read-SystemSecretStore `
    -Path $storePath `
    -RequireAdministratorIdentity `
    -AllowTelegramEnabled:$AllowTelegramEnabled
} else {
  @{}
}

try {
  foreach ($name in @($Set)) {
    if ((Get-SystemSecretAllowedNames) -notcontains $name) {
      throw 'SYSTEM_SECRET_NAME_NOT_ALLOWED'
    }
    $secureValue = Read-Host "Enter protected value for $name" -AsSecureString
    try {
      $values[$name] = ConvertFrom-SystemSecureString -Value $secureValue
    } finally {
      $secureValue.Dispose()
    }
  }

  Write-SystemSecretStore `
    -Values $values `
    -Path $storePath `
    -AllowTelegramEnabled:$AllowTelegramEnabled

  [pscustomobject]@{
    Status = 'SYSTEM_SECRET_STORE_UPDATED'
    StorePath = $storePath
    ProtectedValueCount = $values.Count
    TelegramEnabled = ([string]$values['TELEGRAM_ORDER_ENABLED'] -eq 'true')
  }
} finally {
  foreach ($name in @($values.Keys)) {
    $values[$name] = $null
  }
  $values.Clear()
}
