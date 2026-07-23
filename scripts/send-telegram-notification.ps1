param(
  [Parameter(Mandatory)]
  [ValidateLength(1, 1000)]
  [string]$Message,
  [string]$TelegramCommand = 'C:\Users\roman\AppData\Roaming\npm\codex-tg.ps1',
  [string]$TelegramStateDirectory = 'C:\Users\roman\.codex\telegram-bridge'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $TelegramCommand)) {
  throw "codex-tg was not found at $TelegramCommand."
}
if (-not (Test-Path -LiteralPath $TelegramStateDirectory)) {
  throw "Telegram bridge state directory was not found at $TelegramStateDirectory."
}

$previousStateDirectory = $env:CODEX_TELEGRAM_STATE_DIR
$env:CODEX_TELEGRAM_STATE_DIR = $TelegramStateDirectory
try {
  & $TelegramCommand notify $Message
  if ($LASTEXITCODE -ne 0) {
    throw "codex-tg notify exited with code $LASTEXITCODE."
  }
} finally {
  if ($null -eq $previousStateDirectory) {
    Remove-Item Env:CODEX_TELEGRAM_STATE_DIR -ErrorAction SilentlyContinue
  } else {
    $env:CODEX_TELEGRAM_STATE_DIR = $previousStateDirectory
  }
}
