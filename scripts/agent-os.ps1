#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Position=0)][string]$Area = "help",
    [Parameter(Position=1)][string]$Action,
    [string]$RepositoryRoot,
    [string]$Title,
    [string]$Goal,
    [string[]]$AllowedScope = @(),
    [string[]]$ProtectedScope = @(),
    [string[]]$ParkedFiles = @(),
    [string[]]$Path = @(),
    [string]$Reason = "parked by user",
    [string]$RiskLevel = "MEDIUM",
    [string]$Profile = "default",
    [string]$Note,
    [string]$CommitHash,
    [switch]$AutoParkUnrelatedBaseline,
    [switch]$Force,
    [int]$OlderThanDays = 14,
    [int]$Last = 50,
    [string]$Phase,
    [switch]$AllowNoStagedFiles,
    [switch]$EvidenceOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = if ($RepositoryRoot) {
    (Resolve-Path -LiteralPath $RepositoryRoot -ErrorAction Stop).Path
}
else {
    (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
}

$gitRoot = (& git -C $repoRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $gitRoot) {
    throw "Agent OS repository root is not a Git repository: $repoRoot"
}
$repoRoot = $gitRoot.Trim()

Import-Module (Join-Path $repoRoot "modules\AgentOS\AgentOS.psd1") -Force

function Show-AgentOsHelp {
@"
Agent OS CLI v1.0.0

Commands:
  agent-os init
  agent-os task new
  agent-os task status
  agent-os task validate
  agent-os task manifest
  agent-os park add -Path <files> [-Reason <text>]
  agent-os park remove -Path <files>
  agent-os park list
  agent-os scope check
  agent-os verify run -Profile <name>
  agent-os savepoint create
  agent-os commit check
  agent-os task phase -Phase <phase> [-Note <text>]
  agent-os task complete -CommitHash <hash> [-EvidenceOnly]
  agent-os system status
  agent-os system recover [-Force]
  agent-os system cleanup [-OlderThanDays <days>]
  agent-os doctor run
  agent-os audit show -Last 50
  agent-os release verify

Task creation:
  .\scripts\agent-os.ps1 task new `
    -Title "Close ProductPickerModal fix" `
    -Goal "Finish and isolate the fix" `
    -AllowedScope "src/**/ProductPickerModal*","tests/**/ProductPickerModal*" `
    -ProtectedScope "docs/wiki/**" `
    -AutoParkUnrelatedBaseline

Scope classes:
  PREEXISTING_PARKED
  PREEXISTING_ALLOWED
  PREEXISTING_UNCHANGED
  PREEXISTING_UNCLASSIFIED
  NEW_ALLOWED
  NEW_UNEXPECTED
  PROTECTED
"@ | Write-Host
}

switch ("$Area $Action".Trim()) {
    "init" {
        Initialize-AgentOs -RepositoryRoot $repoRoot | Format-List
    }

    "task new" {
        New-AgentOsTask `
            -RepositoryRoot $repoRoot `
            -Title $Title `
            -Goal $Goal `
            -AllowedScope $AllowedScope `
            -ProtectedScope $ProtectedScope `
            -ParkedFiles $ParkedFiles `
            -RiskLevel $RiskLevel `
            -AutoParkUnrelatedBaseline:$AutoParkUnrelatedBaseline `
            -Force:$Force | Format-List
    }

    "task status" {
        Get-AgentOsTask -RepositoryRoot $repoRoot | Format-List
    }

    "task validate" { Test-AgentOsManifest -RepositoryRoot $repoRoot | Format-List }

    "task migrate" { Update-AgentOsTaskToV05 -RepositoryRoot $repoRoot | Format-List }

    "task manifest" {
        Get-AgentOsManifest -RepositoryRoot $repoRoot | ConvertTo-Json -Depth 30
    }

    "park add" {
        Add-AgentOsParkedFile `
            -RepositoryRoot $repoRoot `
            -Path $Path `
            -Reason $Reason | Format-Table path,reason,added_at -AutoSize
    }

    "park remove" {
        Remove-AgentOsParkedFile `
            -RepositoryRoot $repoRoot `
            -Path $Path `
            -Force:$Force | Format-Table path,reason,added_at -AutoSize
    }

    "park check" { Test-AgentOsParkedDrift -RepositoryRoot $repoRoot | Format-List }

    "park list" {
        Get-AgentOsParkedFile -RepositoryRoot $repoRoot |
            Format-Table path,reason,added_at -AutoSize
    }

    "scope check" {
        $result = Test-AgentOsScope -RepositoryRoot $repoRoot
        $result.Files |
            Format-Table Code,Path,Classification,WasDirtyAtStart,Staged -AutoSize
        $result | Select-Object Status,Summary,Evidence | Format-List
        if ($result.Status -ne "PASSED") { exit 2 }
    }

    "verify run" {
        $result = Invoke-AgentOsVerification -RepositoryRoot $repoRoot -Profile $Profile
        $result.Results | Format-Table Name,Status,ExitCode,LogPath -AutoSize
        $result | Select-Object Status,Profile,Evidence | Format-List
        if ($result.Status -ne "PASSED") { exit 3 }
    }

    "savepoint create" {
        New-AgentOsSavepoint -RepositoryRoot $repoRoot -Note $Note | Format-List
    }

    "commit check" {
        $result = Test-AgentOsCommit `
            -RepositoryRoot $repoRoot `
            -AllowNoStagedFiles:$AllowNoStagedFiles
        $result.StagedFiles |
            Format-Table Code,Path,Classification,WasDirtyAtStart -AutoSize
        $result | Select-Object Status,StagedStat,Evidence | Format-List
        if ($result.Status -ne "PASSED") { exit 4 }
    }


    "task phase" {
        Set-AgentOsTaskPhase `
            -RepositoryRoot $repoRoot `
            -Phase $Phase `
            -Note $Note `
            -Force:$Force | Format-List
    }

    "task complete" {
        Complete-AgentOsTask `
            -RepositoryRoot $repoRoot `
            -CommitHash $CommitHash `
            -EvidenceOnly:$EvidenceOnly | Format-List
    }



    "doctor run" {
        $result = Invoke-AgentOsDoctor -RepositoryRoot $repoRoot
        $result.Checks | Format-Table Name,Status,Detail -AutoSize
        if ($result.Status -ne "PASSED") { exit 6 }
    }

    "audit show" {
        Get-AgentOsAudit -RepositoryRoot $repoRoot -Last $Last |
            Format-Table recorded_at,operation,status,task_id,transaction_id,detail -AutoSize
    }

    "release verify" {
        $result = Test-AgentOsRelease -RepositoryRoot $repoRoot
        $result.Files | Format-Table Path,Status,Expected,Actual -AutoSize
        if ($result.Status -ne "PASSED") { exit 7 }
    }

    "system status" { Get-AgentOsSystemStatus -RepositoryRoot $repoRoot | Format-List }

    "system recover" { Repair-AgentOsState -RepositoryRoot $repoRoot -Force:$Force | Format-List }

    "system cleanup" { Clear-AgentOsCompletedTransactions -RepositoryRoot $repoRoot -OlderThanDays $OlderThanDays | Format-List }

    default {
        Show-AgentOsHelp
    }
}
