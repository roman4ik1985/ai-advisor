Set-StrictMode -Version Latest

$script:SystemSecretStoreVersion = 1
$script:SystemSecretAllowedNames = @(
  'AI_PROVIDER',
  'HOST',
  'ALLOWED_ORIGINS',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_REASONING_EFFORT',
  'CODEX_MODEL',
  'CODEX_TIMEOUT_MS',
  'STORE_URL',
  'RATE_LIMIT_PER_MINUTE',
  'AI_MAX_CONCURRENT',
  'AI_MAX_QUEUE',
  'SHUTDOWN_TIMEOUT_MS',
  'LEARNING_LOG_ENABLED',
  'LEARNING_LOG_FILE',
  'BACKEND_INSTANCE_COUNT',
  'PRODUCT_ANALYTICS_ENABLED',
  'SALESDRIVE_SUBDOMAIN',
  'SALESDRIVE_API_KEY',
  'SALESDRIVE_YML_URL',
  'TELEGRAM_ORDER_ENABLED',
  'TELEGRAM_ORDER_BOT_USERNAME',
  'TELEGRAM_ORDER_BOT_TOKEN',
  'TELEGRAM_ORDER_WEBHOOK_SECRET',
  'TELEGRAM_ORDER_REDIS_URL',
  'TELEGRAM_ORDER_MANAGER_CHAT_ID',
  'TELEGRAM_ORDER_RATE_LIMIT_PER_MINUTE'
)
$script:SystemSecretRequiredNames = @(
  'AI_PROVIDER',
  'OPENAI_API_KEY',
  'TELEGRAM_ORDER_ENABLED'
)
$script:SystemSecretAllowedSids = @('S-1-5-18', 'S-1-5-32-544')
$script:SystemSecretChildEnvironmentNames = @(
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'TEMP',
  'TMP',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS'
)
$script:SystemSecretEntropy = [Text.Encoding]::UTF8.GetBytes('AI Advisor SYSTEM secret store v1')

function Get-SystemSecretStorePath {
  [CmdletBinding()]
  param()

  $programData = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
  Join-Path $programData 'AI Advisor\secrets\system-secrets.dpapi'
}

function Get-SystemSecretAllowedNames {
  [CmdletBinding()]
  param()

  @($script:SystemSecretAllowedNames)
}

function Get-SystemSecretChildEnvironmentNames {
  [CmdletBinding()]
  param()

  @($script:SystemSecretChildEnvironmentNames)
}

function ConvertFrom-SystemSecureString {
  [CmdletBinding()]
  param([Parameter(Mandatory)][Security.SecureString]$Value)

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Assert-SystemSecretValues {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][Collections.IDictionary]$Values,
    [switch]$RequireRuntimeValues,
    [switch]$AllowTelegramEnabled
  )

  foreach ($name in @($Values.Keys)) {
    if ($script:SystemSecretAllowedNames -notcontains [string]$name) {
      throw 'SYSTEM_SECRET_NAME_NOT_ALLOWED'
    }
    if ($null -eq $Values[$name] -or $Values[$name] -isnot [string]) {
      throw 'SYSTEM_SECRET_VALUE_INVALID'
    }
    if ([Text.Encoding]::UTF8.GetByteCount([string]$Values[$name]) -gt 16384) {
      throw 'SYSTEM_SECRET_VALUE_TOO_LARGE'
    }
  }

  if (-not $RequireRuntimeValues) {
    return
  }

  foreach ($requiredName in $script:SystemSecretRequiredNames) {
    if (-not $Values.Contains($requiredName) -or [string]::IsNullOrWhiteSpace([string]$Values[$requiredName])) {
      throw 'SYSTEM_SECRET_REQUIRED_VALUE_MISSING'
    }
  }
  if ([string]$Values['AI_PROVIDER'] -ne 'api') {
    throw 'SYSTEM_SECRET_PROVIDER_MUST_BE_API'
  }

  $telegramEnabled = [string]$Values['TELEGRAM_ORDER_ENABLED']
  if ($telegramEnabled -notin @('false', 'true')) {
    throw 'SYSTEM_SECRET_TELEGRAM_FLAG_INVALID'
  }
  if ($telegramEnabled -eq 'true' -and -not $AllowTelegramEnabled) {
    throw 'SYSTEM_SECRET_TELEGRAM_ACTIVATION_NOT_ALLOWED'
  }
}

function Protect-SystemSecretPayload {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][Collections.IDictionary]$Values,
    [switch]$RequireRuntimeValues,
    [switch]$AllowTelegramEnabled
  )

  Assert-SystemSecretValues `
    -Values $Values `
    -RequireRuntimeValues:$RequireRuntimeValues `
    -AllowTelegramEnabled:$AllowTelegramEnabled

  Add-Type -AssemblyName System.Security
  $orderedValues = [ordered]@{}
  foreach ($name in @($Values.Keys | Sort-Object)) {
    $orderedValues[[string]$name] = [string]$Values[$name]
  }

  $plainBytes = $null
  $cipherBytes = $null
  try {
    $plainJson = $orderedValues | ConvertTo-Json -Compress
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($plainJson)
    $cipherBytes = [Security.Cryptography.ProtectedData]::Protect(
      $plainBytes,
      $script:SystemSecretEntropy,
      [Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    [ordered]@{
      version = $script:SystemSecretStoreVersion
      protection = 'DPAPI-LocalMachine'
      names = @($orderedValues.Keys)
      ciphertext = [Convert]::ToBase64String($cipherBytes)
    } | ConvertTo-Json -Compress
  } finally {
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    if ($cipherBytes) { [Array]::Clear($cipherBytes, 0, $cipherBytes.Length) }
    $plainJson = $null
    $orderedValues.Clear()
  }
}

function Unprotect-SystemSecretPayload {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$EnvelopeJson,
    [switch]$RequireRuntimeValues,
    [switch]$AllowTelegramEnabled
  )

  if ([Text.Encoding]::UTF8.GetByteCount($EnvelopeJson) -gt 1048576) {
    throw 'SYSTEM_SECRET_STORE_TOO_LARGE'
  }

  try {
    $envelope = $EnvelopeJson | ConvertFrom-Json
  } catch {
    throw 'SYSTEM_SECRET_STORE_INVALID'
  }
  if (
    $envelope.version -ne $script:SystemSecretStoreVersion -or
    $envelope.protection -ne 'DPAPI-LocalMachine' -or
    [string]::IsNullOrWhiteSpace([string]$envelope.ciphertext)
  ) {
    throw 'SYSTEM_SECRET_STORE_INVALID'
  }

  Add-Type -AssemblyName System.Security
  $cipherBytes = $null
  $plainBytes = $null
  try {
    try {
      $cipherBytes = [Convert]::FromBase64String([string]$envelope.ciphertext)
      $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $cipherBytes,
        $script:SystemSecretEntropy,
        [Security.Cryptography.DataProtectionScope]::LocalMachine
      )
      $plainJson = [Text.Encoding]::UTF8.GetString($plainBytes)
      $decoded = $plainJson | ConvertFrom-Json
    } catch {
      throw 'SYSTEM_SECRET_DECRYPT_FAILED'
    }

    $values = @{}
    foreach ($property in @($decoded.PSObject.Properties)) {
      $values[[string]$property.Name] = [string]$property.Value
    }
    Assert-SystemSecretValues `
      -Values $values `
      -RequireRuntimeValues:$RequireRuntimeValues `
      -AllowTelegramEnabled:$AllowTelegramEnabled
    $values
  } finally {
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    if ($cipherBytes) { [Array]::Clear($cipherBytes, 0, $cipherBytes.Length) }
    $plainJson = $null
    $decoded = $null
  }
}

function Assert-SystemSecretStoreAcl {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)

  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'SYSTEM_SECRET_STORE_REPARSE_POINT_FORBIDDEN'
  }

  $acl = Get-Acl -LiteralPath $Path
  if (-not $acl.AreAccessRulesProtected) {
    throw 'SYSTEM_SECRET_STORE_ACL_INHERITANCE_ENABLED'
  }
  try {
    $ownerSid = if ($acl.Owner -match '^S-\d-(?:\d+-)+\d+$') {
      (New-Object Security.Principal.SecurityIdentifier($acl.Owner)).Value
    } else {
      ([Security.Principal.NTAccount]$acl.Owner).Translate(
        [Security.Principal.SecurityIdentifier]
      ).Value
    }
  } catch {
    throw 'SYSTEM_SECRET_STORE_OWNER_INVALID'
  }
  if ($script:SystemSecretAllowedSids -notcontains $ownerSid) {
    throw 'SYSTEM_SECRET_STORE_OWNER_INVALID'
  }
  foreach ($rule in @($acl.Access)) {
    try {
      $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    } catch {
      throw 'SYSTEM_SECRET_STORE_ACL_TOO_BROAD'
    }
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) {
      if ($rule.IsInherited -or $script:SystemSecretAllowedSids -notcontains $sid) {
        throw 'SYSTEM_SECRET_STORE_ACL_TOO_BROAD'
      }
    }
  }
}

function Set-SystemSecretStoreAcl {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [switch]$Directory
  )

  $acl = if ($Directory) {
    New-Object Security.AccessControl.DirectorySecurity
  } else {
    New-Object Security.AccessControl.FileSecurity
  }
  $acl.SetAccessRuleProtection($true, $false)
  $rights = [Security.AccessControl.FileSystemRights]::FullControl
  $inheritance = if ($Directory) {
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [Security.AccessControl.InheritanceFlags]::None
  }

  foreach ($sidValue in $script:SystemSecretAllowedSids) {
    $sid = New-Object Security.Principal.SecurityIdentifier($sidValue)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      $sid,
      $rights,
      $inheritance,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  Set-Acl -LiteralPath $Path -AclObject $acl
  Assert-SystemSecretStoreAcl -Path (Split-Path -Parent $Path)
  Assert-SystemSecretStoreAcl -Path $Path
}

function Read-SystemSecretStore {
  [CmdletBinding()]
  param(
    [string]$Path = (Get-SystemSecretStorePath),
    [switch]$RequireSystemIdentity,
    [switch]$RequireAdministratorIdentity,
    [switch]$AllowTelegramEnabled
  )

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  if ($RequireSystemIdentity -and $identity.User.Value -ne 'S-1-5-18') {
    throw 'SYSTEM_SECRET_LOADER_REQUIRES_SYSTEM'
  }
  if ($RequireAdministratorIdentity) {
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      throw 'SYSTEM_SECRET_PROVISIONING_REQUIRES_ADMINISTRATOR'
    }
  }

  Assert-SystemSecretStoreAcl -Path $Path
  $envelopeJson = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
  Unprotect-SystemSecretPayload `
    -EnvelopeJson $envelopeJson `
    -RequireRuntimeValues `
    -AllowTelegramEnabled:$AllowTelegramEnabled
}

function Write-SystemSecretStore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][Collections.IDictionary]$Values,
    [string]$Path = (Get-SystemSecretStorePath),
    [switch]$AllowTelegramEnabled
  )

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'SYSTEM_SECRET_PROVISIONING_REQUIRES_ADMINISTRATOR'
  }

  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  Set-SystemSecretStoreAcl -Path $directory -Directory

  $envelopeJson = Protect-SystemSecretPayload `
    -Values $Values `
    -RequireRuntimeValues `
    -AllowTelegramEnabled:$AllowTelegramEnabled
  $temporaryPath = "$Path.$PID.new"
  try {
    [IO.File]::WriteAllText($temporaryPath, $envelopeJson, (New-Object Text.UTF8Encoding($false)))
    Set-SystemSecretStoreAcl -Path $temporaryPath
    if (Test-Path -LiteralPath $Path) {
      [IO.File]::Replace($temporaryPath, $Path, $null)
    } else {
      [IO.File]::Move($temporaryPath, $Path)
    }
    Set-SystemSecretStoreAcl -Path $Path
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
    $envelopeJson = $null
  }
}
