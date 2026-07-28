#Requires -Version 5.1
# TestHelpers.ps1 — shared fixture utilities for the Agent OS 1.0 test contour.
# Loaded by every AOS10-* test file via BeforeAll.

# ---------------------------------------------------------------------------
# Environment detection
# ---------------------------------------------------------------------------

function Get-AosTestEnvInfo {
    [CmdletBinding()]
    param()
    [ordered]@{
        PSVersion       = $PSVersionTable.PSVersion.ToString()
        PSEdition       = $PSVersionTable.PSEdition
        OS              = if ($PSVersionTable.PSVersion -lt [version]'6.0') { 'Windows' } else { $PSVersionTable.OS }
        PesterVersion   = (Get-Module Pester).Version.ToString()
        GitVersion      = (& git --version) 2>$null | ForEach-Object { ($_ -split ' ')[-1] }
        NodeVersion     = try { (& node --version) 2>$null } catch { 'n/a' }
    }
}

# ---------------------------------------------------------------------------
# Pester 6 module-loading workaround
# ---------------------------------------------------------------------------

function Import-AosModule {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot
    )
    $modulePath = Join-Path $RepositoryRoot 'modules\AgentOS\AgentOS.psd1'
    # Force import into the *global* session state so InModuleScope works.
    Import-Module $modulePath -Force -Global -PassThru:$false
}

# ---------------------------------------------------------------------------
# Temporary Git repository fixture
# ---------------------------------------------------------------------------

function New-AosTempRepo {
    [CmdletBinding()]
    param(
        [string]$Prefix = 'aos-test',
        [string[]]$InitialFiles = @('README.md'),
        [switch]$NoCommit
    )
    # Use a short base path to avoid Windows MAX_PATH (260) limits when
    # transaction backup filenames are Base64-encoded full paths.
    $base = 'C:\aos-tmp'
    New-Item -ItemType Directory -Path $base -Force | Out-Null
    $name = "{0}-{1}-{2}" -f $Prefix, (Get-Date -Format 'HHmmss-fff'), ([guid]::NewGuid().ToString('N').Substring(0, 6))
    $repo = Join-Path $base $name
    New-Item -ItemType Directory -Path $repo -Force | Out-Null

    Push-Location $repo
    try {
        & git init 2>&1 | Out-Null
        & git -c user.email=test@aos.local -c user.name='AOS Test' rev-parse --is-inside-work-tree 2>$null | Out-Null
        # Set local git identity so commits don't fail on machines without global config.
        & git config user.email 'test@aos.local' 2>&1 | Out-Null
        & git config user.name 'AOS Test' 2>&1 | Out-Null
        & git config commit.gpgsign false 2>&1 | Out-Null
        & git config core.autocrlf false 2>&1 | Out-Null

        foreach ($f in $InitialFiles) {
            $dir = Split-Path $f -Parent
            if ($dir) {
                New-Item -ItemType Directory -Path (Join-Path $repo $dir) -Force | Out-Null
            }
            if (-not (Test-Path (Join-Path $repo $f))) {
                Set-Content -LiteralPath (Join-Path $repo $f) -Value "# $f`nInitial content." -Encoding UTF8
            }
        }

        if (-not $NoCommit) {
            & git add -- @InitialFiles 2>&1 | Out-Null
            & git -c user.email=test@aos.local -c user.name='AOS Test' commit -m "Initial fixture commit" --no-gpg-sign 2>&1 | Out-Null
        }
    }
    finally {
        Pop-Location
    }
    $repo
}

function Remove-AosTempRepo {
    [CmdletBinding()]
    param(
        [Parameter()][string]$Path
    )
    if ($Path -and (Test-Path -LiteralPath $Path -PathType Container)) {
        # Force-remove read-only files that git may have created.
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

function Set-AosFileContent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$RelativePath,
        [Parameter(Mandatory)][string]$Content
    )
    $full = Join-Path $RepositoryRoot ($RelativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
    $dir = Split-Path $full -Parent
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Set-Content -LiteralPath $full -Value $Content -Encoding UTF8 -NoNewline
}

function Get-AosFileContent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$RelativePath
    )
    $full = Join-Path $RepositoryRoot ($RelativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
    Get-Content -LiteralPath $full -Raw
}

function Get-AosFileHash {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$RelativePath
    )
    $full = Join-Path $RepositoryRoot ($RelativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
    (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
}

# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

function Invoke-AosGit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    Push-Location $RepositoryRoot
    try {
        $output = & git @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    [pscustomobject]@{ ExitCode = $exitCode; Output = @($output); Text = ($output -join [Environment]::NewLine) }
}

function New-AosGitCommit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [string]$Message = 'test commit'
    )
    Push-Location $RepositoryRoot
    try {
        & git -c user.email=test@aos.local -c user.name='AOS Test' commit -m $Message --no-gpg-sign 2>&1 | Out-Null
        (Invoke-AosGit -RepositoryRoot $RepositoryRoot -Arguments @('rev-parse', 'HEAD')).Text.Trim()
    }
    finally {
        Pop-Location
    }
}

function Add-AosFixtureChanges {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    $paths = @((Invoke-AosGit -RepositoryRoot $RepositoryRoot -Arguments @('status', '--porcelain')).Output |
        ForEach-Object { if ($_.Length -ge 4) { $_.Substring(3).Trim() } } |
        Where-Object { $_ })
    if ($paths.Count -gt 0) { Invoke-AosGit -RepositoryRoot $RepositoryRoot -Arguments (@('add', '--') + $paths) | Out-Null }
}

function Install-AosFixturePackage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$SourceRoot
    )
    $installer = Join-Path $SourceRoot 'scripts\install-agent-os.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -RepositoryRoot $RepositoryRoot 2>&1 | Out-Null
    Invoke-AosGit -RepositoryRoot $RepositoryRoot -Arguments @('add', '--', 'RELEASE-MANIFEST.json', 'modules', 'scripts', '.agent-os/config', '.agent-os/templates') | Out-Null
    New-AosGitCommit -RepositoryRoot $RepositoryRoot -Message 'install Agent OS fixture package' | Out-Null
}

# ---------------------------------------------------------------------------
# CLI invocation helper
# ---------------------------------------------------------------------------

function Invoke-AosCli {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$PwshExe,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    $cliPath = Join-Path $RepositoryRoot 'scripts\agent-os.ps1'
    $allArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cliPath) + $Arguments
    Push-Location $RepositoryRoot
    try {
        $output = & $PwshExe @allArgs 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = @($output)
        Text     = ($output -join [Environment]::NewLine)
    }
}

# ---------------------------------------------------------------------------
# Assertion helpers
# ---------------------------------------------------------------------------

function Get-AosTaskState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot
    )
    $statePath = Join-Path $RepositoryRoot '.agent-os\state\current-task.json'
    if (-not (Test-Path $statePath)) { return $null }
    Get-Content $statePath -Raw | ConvertFrom-Json
}

function Get-AosActiveTaskFiles {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot
    )
    $dir = Join-Path $RepositoryRoot '.agent-os\tasks\active'
    if (-not (Test-Path $dir)) { return @() }
    @(Get-ChildItem $dir -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
}
