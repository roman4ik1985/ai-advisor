function Get-AgentOsPaths {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $agentRoot = Join-Path $RepositoryRoot ".agent-os"

    [ordered]@{
        Root             = $agentRoot
        Config           = Join-Path $agentRoot "config"
        Templates        = Join-Path $agentRoot "templates"
        State            = Join-Path $agentRoot "state"
        CurrentTask      = Join-Path $agentRoot "state\current-task.json"
        LockFile         = Join-Path $agentRoot "state\agent-os.lock.json"
        Transactions     = Join-Path $agentRoot "state\transactions"
        Recovery         = Join-Path $agentRoot "state\recovery"
        TasksActive      = Join-Path $agentRoot "tasks\active"
        TasksCompleted   = Join-Path $agentRoot "tasks\completed"
        Manifests        = Join-Path $agentRoot "manifests"
        Savepoints       = Join-Path $agentRoot "savepoints"
        Evidence         = Join-Path $agentRoot "evidence"
        EvidenceBuild    = Join-Path $agentRoot "evidence\build"
        EvidenceTests    = Join-Path $agentRoot "evidence\tests"
        EvidenceSmoke    = Join-Path $agentRoot "evidence\smoke"
        EvidenceReview   = Join-Path $agentRoot "evidence\review"
        Logs             = Join-Path $agentRoot "logs"
        CommandsConfig   = Join-Path $agentRoot "config\commands.json"
        PolicyConfig     = Join-Path $agentRoot "config\policy.json"
    }
}

function Initialize-AgentOsDirectories {
    [CmdletBinding()]
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Paths)

    foreach ($name in @(
        "Root","Config","Templates","State","Transactions","Recovery","TasksActive","TasksCompleted",
        "Manifests","Savepoints","Evidence","EvidenceBuild","EvidenceTests",
        "EvidenceSmoke","EvidenceReview","Logs"
    )) {
        New-Item -ItemType Directory -Path $Paths[$name] -Force | Out-Null
    }
}
