#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Distro = "Ubuntu",
    [ValidateRange(1024, 65535)]
    [int]$Port = 16391,
    [string]$ValkeyHome = "/home/roman/.local/opt/valkey-9.1.1"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$valkeyServer = "$ValkeyHome/bin/valkey-server"
$valkeyCli = "$ValkeyHome/bin/valkey-cli"
$runId = [Guid]::NewGuid().ToString("N")
$dataDir = "/tmp/ai-advisor-valkey-acceptance-$runId"
$pidFile = "$dataDir/valkey.pid"
$logFile = "$dataDir/valkey.log"
$testUrl = "redis://127.0.0.1:$Port"
$testPrefix = "aiadvisor:valkeyaccept"
$serverStarted = $false

function Invoke-WslChecked {
    param([Parameter(Mandatory)][string[]]$Command)

    $output = & wsl.exe -d $Distro -- @Command
    if ($LASTEXITCODE -ne 0) {
        throw "WSL command failed: $($Command[0])"
    }
    return $output
}

function Test-ValkeyReady {
    $output = & wsl.exe -d $Distro -- $valkeyCli -h 127.0.0.1 -p $Port PING 2>$null
    return $LASTEXITCODE -eq 0 -and ($output -join "").Trim() -eq "PONG"
}

function Wait-ValkeyReady {
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
        if (Test-ValkeyReady) {
            return
        }
        Start-Sleep -Milliseconds 100
    }
    $log = & wsl.exe -d $Distro -- tail -n 80 $logFile 2>$null
    throw "Valkey did not become ready. Log: $($log -join [Environment]::NewLine)"
}

function Wait-ValkeyStopped {
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
        if (-not (Test-ValkeyReady)) {
            return
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Valkey did not stop on port $Port."
}

function Start-TestValkey {
    Invoke-WslChecked -Command @(
        $valkeyServer,
        "--port", [string]$Port,
        "--bind", "127.0.0.1",
        "--protected-mode", "yes",
        "--daemonize", "yes",
        "--pidfile", $pidFile,
        "--dir", $dataDir,
        "--dbfilename", "dump.rdb",
        "--appendonly", "yes",
        "--appenddirname", "appendonlydir",
        "--appendfsync", "always",
        "--save", "1 1",
        "--logfile", $logFile
    ) | Out-Null
    $script:serverStarted = $true
    Wait-ValkeyReady
}

function Stop-TestValkey {
    param([ValidateSet("SAVE", "NOSAVE")][string]$Mode = "SAVE")

    if (-not $script:serverStarted) {
        return
    }
    & wsl.exe -d $Distro -- $valkeyCli -h 127.0.0.1 -p $Port SHUTDOWN $Mode 2>$null | Out-Null
    Wait-ValkeyStopped
    $script:serverStarted = $false
}

function Invoke-NodePhase {
    param([Parameter(Mandatory)][ValidateSet("compatibility", "recovery", "outage")][string]$Phase)

    $previousUrl = $env:VALKEY_TEST_URL
    $previousPrefix = $env:VALKEY_TEST_PREFIX
    try {
        $env:VALKEY_TEST_URL = $testUrl
        $env:VALKEY_TEST_PREFIX = $testPrefix
        $output = & node "$PSScriptRoot/valkey-compatibility-smoke.mjs" $Phase
        if ($LASTEXITCODE -ne 0) {
            throw "Node Valkey phase failed: $Phase"
        }
        return ($output -join [Environment]::NewLine).Trim()
    }
    finally {
        $env:VALKEY_TEST_URL = $previousUrl
        $env:VALKEY_TEST_PREFIX = $previousPrefix
    }
}

if (Test-ValkeyReady) {
    throw "Port $Port already has a Valkey-compatible listener; refusing to reuse it."
}

$version = (Invoke-WslChecked -Command @($valkeyServer, "--version") | Out-String).Trim()
if ($version -notmatch "\bv=9\.1\.1\b") {
    throw "Expected Valkey 9.1.1 at $valkeyServer."
}

Invoke-WslChecked -Command @("mkdir", "-p", $dataDir) | Out-Null

try {
    Start-TestValkey
    $compatibility = Invoke-NodePhase -Phase "compatibility"

    Invoke-WslChecked -Command @(
        $valkeyCli, "-h", "127.0.0.1", "-p", [string]$Port, "SAVE"
    ) | Out-Null

    Stop-TestValkey -Mode "SAVE"
    Start-TestValkey
    $cleanRecovery = Invoke-NodePhase -Phase "recovery"

    $pidText = (Invoke-WslChecked -Command @("cat", $pidFile) | Out-String).Trim()
    if ($pidText -notmatch "^[1-9][0-9]{0,9}$") {
        throw "Invalid Valkey PID file."
    }
    Invoke-WslChecked -Command @("kill", "-9", $pidText) | Out-Null
    Wait-ValkeyStopped
    $serverStarted = $false

    $outage = Invoke-NodePhase -Phase "outage"

    Start-TestValkey
    $forcedRecovery = Invoke-NodePhase -Phase "recovery"

    [ordered]@{
        status = "PASS"
        distro = $Distro
        server = "Valkey 9.1.1"
        install = $ValkeyHome
        endpoint = "loopback:$Port"
        persistence = "AOF appendfsync always + RDB"
        compatibility = ($compatibility | ConvertFrom-Json)
        cleanRestart = ($cleanRecovery | ConvertFrom-Json)
        outage = ($outage | ConvertFrom-Json)
        forcedStopRecovery = ($forcedRecovery | ConvertFrom-Json)
        telegramEnabled = $false
    } | ConvertTo-Json -Depth 6
}
finally {
    try {
        Stop-TestValkey -Mode "NOSAVE"
    }
    catch {
        Write-Warning "Valkey cleanup stop failed: $($_.Exception.Message)"
    }

    if ($dataDir -notmatch "^/tmp/ai-advisor-valkey-acceptance-[a-f0-9]{32}$") {
        throw "Unsafe Valkey cleanup path."
    }
    Invoke-WslChecked -Command @("rm", "-rf", "--", $dataDir) | Out-Null
}
