function Invoke-AgentOsDoctor {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $checks = [System.Collections.Generic.List[psobject]]::new()

    function Add-Check([string]$Name,[bool]$Passed,[string]$Detail) {
        $checks.Add([pscustomobject]@{
            Name=$Name
            Status=if($Passed){"PASSED"}else{"FAILED"}
            Detail=$Detail
        })
    }

    Add-Check "repository-root" (Test-Path -LiteralPath $RepositoryRoot -PathType Container) $RepositoryRoot

    $git = Get-Command git -ErrorAction SilentlyContinue
    Add-Check "git" ($null -ne $git) $(if($git){$git.Source}else{"git not found"})

    $modulePath = Join-Path $RepositoryRoot "modules\AgentOS\AgentOS.psd1"
    Add-Check "module-manifest" (Test-Path -LiteralPath $modulePath) $modulePath

    $paths = Get-AgentOsPaths -RepositoryRoot $RepositoryRoot
    Initialize-AgentOsDirectories -Paths $paths
    $activeTaskFiles = @(
        Get-ChildItem -LiteralPath $paths.TasksActive -Filter "*.json" -ErrorAction SilentlyContinue
    )

    $lock = Read-AgentOsJsonRaw -Path $paths.LockFile
    $lockHealthy = $true
    $lockDetail = "No lock."
    if ($lock) {
        $alive = Test-AgentOsProcessAlive -ProcessId ([int]$lock.process_id)
        $lockHealthy = $alive
        $lockDetail = if($alive){"Active lock owned by live PID $($lock.process_id)."}else{"Orphan lock detected."}
    }
    Add-Check "lock-health" $lockHealthy $lockDetail

    $started = @(
        Get-ChildItem -LiteralPath $paths.Transactions -Filter "*.json" -ErrorAction SilentlyContinue |
            ForEach-Object { Read-AgentOsJsonRaw -Path $_.FullName } |
            Where-Object status -eq "STARTED"
    )
    Add-Check "transactions" ($started.Count -eq 0) "$($started.Count) unfinished transaction(s)."

    if (Test-Path -LiteralPath $paths.CurrentTask) {
        try {
            $task = Get-AgentOsTask -RepositoryRoot $RepositoryRoot
            Add-Check "task-json" ($null -ne $task.id) "Task $($task.id), phase $($task.status)."

            $expectedActivePath = Join-Path $paths.TasksActive "$($task.id).json"
            $orphaned = @($activeTaskFiles | Where-Object { $_.FullName -ne $expectedActivePath })
            Add-Check "orphan-task-state" ($orphaned.Count -eq 0) $(if ($orphaned.Count -eq 0) { "No orphan active task state." } else { "Orphan active task state: $($orphaned.Name -join ', ')." })

            $manifestResult = Test-AgentOsManifest -RepositoryRoot $RepositoryRoot
            Add-Check "task-manifest" ([bool]$manifestResult.Valid) ($manifestResult.Errors -join "; ")
        }
        catch {
            Add-Check "task-state" $false $_.Exception.Message
        }
    }
    else {
        Add-Check "task-state" ($activeTaskFiles.Count -eq 0) $(if ($activeTaskFiles.Count -eq 0) { "No active task." } else { "Current task pointer is missing; orphan active task state: $($activeTaskFiles.Name -join ', ')." })
    }

    $failed = @($checks | Where-Object Status -eq "FAILED")
    [pscustomobject]@{
        Status = if($failed.Count -eq 0){"PASSED"}else{"FAILED"}
        Checks = $checks.ToArray()
    }
}

function Test-AgentOsRelease {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $manifestPath = Join-Path $RepositoryRoot "RELEASE-MANIFEST.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "RELEASE-MANIFEST.json not found."
    }

    $manifest = Read-AgentOsJsonRaw -Path $manifestPath
    $results = @()

    foreach ($entry in @($manifest.files)) {
        $path = Join-Path $RepositoryRoot ([string]$entry.path).Replace("/",[IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            $results += [pscustomobject]@{ Path=$entry.path; Status="MISSING"; Expected=$entry.sha256; Actual=$null }
            continue
        }

        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        $results += [pscustomobject]@{
            Path=$entry.path
            Status=if($actual -eq [string]$entry.sha256){"PASSED"}else{"MISMATCH"}
            Expected=$entry.sha256
            Actual=$actual
        }
    }

    [pscustomobject]@{
        Status = if(@($results | Where-Object Status -ne "PASSED").Count -eq 0){"PASSED"}else{"FAILED"}
        Files = $results
    }
}

function Get-AgentOsAudit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [int]$Last = 50
    )

    Read-AgentOsAuditEvent -RepositoryRoot $RepositoryRoot -Last $Last
}
