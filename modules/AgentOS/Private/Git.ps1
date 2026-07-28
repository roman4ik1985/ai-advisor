function Invoke-AgentOsGit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$AllowFailure
    )

    Push-Location $RepositoryRoot
    try {
        $output = & git @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "Git failed: git $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = @($output)
        Text     = ($output -join [Environment]::NewLine)
    }
}

function ConvertFrom-AgentOsGitStatus {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string[]]$Lines)

    foreach ($line in $Lines) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt 4) {
            continue
        }

        $xy = $line.Substring(0, 2)
        $path = $line.Substring(3).Trim()

        if ($path -match " -> ") {
            $path = ($path -split " -> ", 2)[1]
        }

        [pscustomobject]@{
            Code      = $xy
            Path      = $path.Replace("\", "/")
            Staged    = ($xy[0] -ne " " -and $xy[0] -ne "?")
            Worktree  = ($xy[1] -ne " ")
            Untracked = ($xy -eq "??")
        }
    }
}

function Get-AgentOsGitSnapshot {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $branch = (Invoke-AgentOsGit -RepositoryRoot $RepositoryRoot -Arguments @("branch","--show-current")).Text.Trim()
    $head = (Invoke-AgentOsGit -RepositoryRoot $RepositoryRoot -Arguments @("rev-parse","HEAD")).Text.Trim()
    $statusResult = Invoke-AgentOsGit -RepositoryRoot $RepositoryRoot -Arguments @(
        "status","--porcelain=v1","--untracked-files=all"
    )

    [pscustomobject]@{
        captured_at = [DateTimeOffset]::Now.ToString("o")
        branch      = $branch
        head        = $head
        entries     = @(ConvertFrom-AgentOsGitStatus -Lines $statusResult.Output)
    }
}
