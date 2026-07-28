BeforeAll {
    Import-Module (Join-Path $PSScriptRoot "..\modules\AgentOS\AgentOS.psd1") -Force
}

Import-Module (Join-Path $PSScriptRoot "..\modules\AgentOS\AgentOS.psd1") -Force

Describe "Agent OS v0.4 public API" {
    It "exports parked-file commands" {
        $commands = Get-Command -Module AgentOS | Select-Object -ExpandProperty Name

        $commands | Should -Contain "Add-AgentOsParkedFile"
        $commands | Should -Contain "Remove-AgentOsParkedFile"
        $commands | Should -Contain "Get-AgentOsParkedFile"
        $commands | Should -Contain "Get-AgentOsManifest"
    }
}

Describe "Baseline-aware scope classification" {
    InModuleScope AgentOS {
        BeforeEach {
            $task = [pscustomobject]@{
                allowed_scope = @("src/**/ProductPickerModal*")
                protected_scope = @("docs/secret/**")
                parked_files = @(
                    [pscustomobject]@{
                        path = "docs/wiki/parked.md"
                        reason = "parked"
                    }
                )
                baseline = [pscustomobject]@{
                    entries = @(
                        [pscustomobject]@{
                            Code = " M"
                            Path = "docs/wiki/parked.md"
                            fingerprint = [pscustomobject]@{
                                algorithm = "SHA256"
                                exists = $true
                                hash = "unchanged"
                                length = 1
                            }
                        },
                        [pscustomobject]@{
                            Code = " M"
                            Path = "src/features/ProductPickerModal.tsx"
                        },
                        [pscustomobject]@{
                            Code = "??"
                            Path = "tmp/preexisting.txt"
                        }
                    )
                }
            }
        }

        It "classifies a parked dirty baseline file" {
            $entry = [pscustomobject]@{
                Code = " M"
                Path = "docs/wiki/parked.md"
                Staged = $false
                Worktree = $true
                Untracked = $false
            }

            $result = Get-AgentOsScopeClassification -Entries @($entry) -Task $task
            $result[0].Classification | Should -Be "PREEXISTING_PARKED"
        }

        It "blocks a parked dirty baseline file without a fingerprint" {
            $task.baseline.entries[0].PSObject.Properties.Remove("fingerprint")
            $entry = [pscustomobject]@{
                Code = " M"
                Path = "docs/wiki/parked.md"
                Staged = $false
                Worktree = $true
                Untracked = $false
            }

            $classified = @(Get-AgentOsScopeClassification -Entries @($entry) -Task $task)
            $classified[0].Classification | Should -Be "PARKED_DRIFT"
            (Test-AgentOsScopePass -Classified $classified).Passed | Should -BeFalse
        }

        It "classifies a new allowed file" {
            $entry = [pscustomobject]@{
                Code = "??"
                Path = "tests/ProductPickerModal.test.tsx"
                Staged = $false
                Worktree = $true
                Untracked = $true
            }

            $task.allowed_scope += "tests/**/ProductPickerModal*"
            $result = Get-AgentOsScopeClassification -Entries @($entry) -Task $task
            $result[0].Classification | Should -Be "NEW_ALLOWED"
        }

        It "classifies a preexisting allowed file" {
            $entry = [pscustomobject]@{
                Code = " M"
                Path = "src/features/ProductPickerModal.tsx"
                Staged = $false
                Worktree = $true
                Untracked = $false
            }

            $result = Get-AgentOsScopeClassification -Entries @($entry) -Task $task
            $result[0].Classification | Should -Be "PREEXISTING_ALLOWED"
        }

        It "blocks an unclassified dirty baseline file" {
            $entry = [pscustomobject]@{
                Code = "??"
                Path = "tmp/preexisting.txt"
                Staged = $false
                Worktree = $true
                Untracked = $true
            }

            $classified = @(Get-AgentOsScopeClassification -Entries @($entry) -Task $task)
            $classified[0].Classification | Should -Be "PREEXISTING_UNCLASSIFIED"

            $gate = Test-AgentOsScopePass -Classified $classified
            $gate.Passed | Should -BeFalse
        }

        It "blocks a new unexpected file" {
            $entry = [pscustomobject]@{
                Code = "??"
                Path = "tmp/new-debug.txt"
                Staged = $false
                Worktree = $true
                Untracked = $true
            }

            $classified = @(Get-AgentOsScopeClassification -Entries @($entry) -Task $task)
            $classified[0].Classification | Should -Be "NEW_UNEXPECTED"

            $gate = Test-AgentOsScopePass -Classified $classified
            $gate.Passed | Should -BeFalse
        }

        It "gives protected scope highest priority" {
            $entry = [pscustomobject]@{
                Code = " M"
                Path = "docs/secret/passwords.md"
                Staged = $false
                Worktree = $true
                Untracked = $false
            }

            $result = Get-AgentOsScopeClassification -Entries @($entry) -Task $task
            $result[0].Classification | Should -Be "PROTECTED"
        }
    }
}

Describe "Manifest conversion" {
    InModuleScope AgentOS {
        It "preserves baseline and parked files" {
            $baseline = [pscustomobject]@{
                branch = "main"
                head = "abc"
                entries = @()
            }

            $manifest = New-AgentOsManifestObject `
                -TaskId "TASK-1" `
                -Title "Example" `
                -Goal "Do work" `
                -RepositoryRoot "C:\repo" `
                -Baseline $baseline `
                -AllowedScope @("src/**") `
                -ProtectedScope @("docs/**") `
                -ParkedFiles @(
                    [pscustomobject]@{ path = "wiki.md"; reason = "parked" }
                ) `
                -RiskLevel "MEDIUM"

            $task = Convert-AgentOsManifestToTaskState -Manifest $manifest
            $task.baseline.head | Should -Be "abc"
            $task.parked_files[0].path | Should -Be "wiki.md"
        }
    }
}


Describe "Fingerprint comparison" {
    InModuleScope AgentOS {
        It "detects parked drift" {
            Test-AgentOsFingerprintEqual `
              ([pscustomobject]@{algorithm='SHA256';exists=$true;hash='a';length=1}) `
              ([pscustomobject]@{algorithm='SHA256';exists=$true;hash='b';length=1}) |
              Should -BeFalse
        }
    }
}


Describe "Transactional integration" {
    InModuleScope AgentOS {
        It "rolls back a created JSON file when an operation fails" {
            $repo = Join-Path $TestDrive "tx-repo"
            New-Item -ItemType Directory -Path $repo | Out-Null
            $paths = Get-AgentOsPaths -RepositoryRoot $repo
            Initialize-AgentOsDirectories -Paths $paths
            $target = Join-Path $paths.State "created.json"

            { Invoke-AgentOsTransactionalOperation -RepositoryRoot $repo -Operation "test" -ScriptBlock {
                Save-AgentOsJson -Value @{ value = 1 } -Path $target
                throw "boom"
            } } | Should -Throw

            Test-Path -LiteralPath $target | Should -BeFalse
            Test-Path -LiteralPath $paths.LockFile | Should -BeFalse
        }

        It "restores an overwritten JSON file when an operation fails" {
            $repo = Join-Path $TestDrive "tx-restore"
            New-Item -ItemType Directory -Path $repo | Out-Null
            $paths = Get-AgentOsPaths -RepositoryRoot $repo
            Initialize-AgentOsDirectories -Paths $paths
            $target = Join-Path $paths.State "state.json"
            Save-AgentOsJsonRaw -Value @{ value = "before" } -Path $target

            { Invoke-AgentOsTransactionalOperation -RepositoryRoot $repo -Operation "test" -ScriptBlock {
                Save-AgentOsJson -Value @{ value = "after" } -Path $target
                throw "boom"
            } } | Should -Throw

            (Read-AgentOsJsonRaw -Path $target).value | Should -Be "before"
        }

        It "commits all writes on success" {
            $repo = Join-Path $TestDrive "tx-success"
            New-Item -ItemType Directory -Path $repo | Out-Null
            $paths = Get-AgentOsPaths -RepositoryRoot $repo
            Initialize-AgentOsDirectories -Paths $paths
            $target = Join-Path $paths.State "state.json"

            Invoke-AgentOsTransactionalOperation -RepositoryRoot $repo -Operation "test" -ScriptBlock {
                Save-AgentOsJson -Value @{ value = "committed" } -Path $target
            }

            (Read-AgentOsJsonRaw -Path $target).value | Should -Be "committed"
            $transactions = @(Get-ChildItem $paths.Transactions -Filter "*.json")
            (Read-AgentOsJsonRaw -Path $transactions[0].FullName).status | Should -Be "COMPLETED"
        }
    }
}


Describe "Transactional delete" {
    InModuleScope AgentOS {
        It "restores a deleted file when the operation fails" {
            $repo = Join-Path $TestDrive "tx-delete"
            New-Item -ItemType Directory -Path $repo | Out-Null
            $paths = Get-AgentOsPaths -RepositoryRoot $repo
            Initialize-AgentOsDirectories -Paths $paths
            $target = Join-Path $paths.State "delete-me.json"
            Save-AgentOsJsonRaw -Value @{ value = "preserve" } -Path $target

            { Invoke-AgentOsTransactionalOperation -RepositoryRoot $repo -Operation "delete-test" -ScriptBlock {
                Remove-AgentOsTransactionalFile -Path $target
                throw "boom"
            } } | Should -Throw

            Test-Path -LiteralPath $target | Should -BeTrue
            (Read-AgentOsJsonRaw -Path $target).value | Should -Be "preserve"
        }
    }
}

Describe "Orphan active task recovery" {
    InModuleScope AgentOS {
        It "reports an active task file without a current task pointer" {
            $repoRoot = Join-Path $TestDrive "orphan-doctor"
            New-Item -ItemType Directory -Path $repoRoot | Out-Null
            $paths = Get-AgentOsPaths -RepositoryRoot $repoRoot
            Initialize-AgentOsDirectories -Paths $paths
            Save-AgentOsJsonRaw -Value @{ id = "TASK-orphan"; status = "BLOCKED" } -Path (Join-Path $paths.TasksActive "TASK-orphan.json")

            $result = Invoke-AgentOsDoctor -RepositoryRoot $repoRoot
            $result.Status | Should -Be "FAILED"
            ($result.Checks | Where-Object Name -eq "task-state").Status | Should -Be "FAILED"
        }

        It "moves orphan active task state into recovery" {
            $repoRoot = Join-Path $TestDrive "orphan-recovery"
            New-Item -ItemType Directory -Path $repoRoot | Out-Null
            $paths = Get-AgentOsPaths -RepositoryRoot $repoRoot
            Initialize-AgentOsDirectories -Paths $paths
            $activePath = Join-Path $paths.TasksActive "TASK-orphan.json"
            Save-AgentOsJsonRaw -Value @{ id = "TASK-orphan"; status = "BLOCKED" } -Path $activePath

            $result = Repair-AgentOsState -RepositoryRoot $repoRoot
            $result.OrphanedTasks | Should -Contain "TASK-orphan.json"
            Test-Path -LiteralPath $activePath | Should -BeFalse
            Test-Path -LiteralPath (Join-Path $paths.Recovery "orphan-active-TASK-orphan.json") | Should -BeTrue
        }

        It "preserves the current task while recovering a stale active task file" {
            $repoRoot = Join-Path $TestDrive "orphan-with-current"
            New-Item -ItemType Directory -Path $repoRoot | Out-Null
            $paths = Get-AgentOsPaths -RepositoryRoot $repoRoot
            Initialize-AgentOsDirectories -Paths $paths
            Save-AgentOsJsonRaw -Value @{ id = "TASK-current"; status = "IN_PROGRESS" } -Path $paths.CurrentTask
            Save-AgentOsJsonRaw -Value @{ id = "TASK-current"; status = "IN_PROGRESS" } -Path (Join-Path $paths.TasksActive "TASK-current.json")
            Save-AgentOsJsonRaw -Value @{ id = "TASK-orphan"; status = "BLOCKED" } -Path (Join-Path $paths.TasksActive "TASK-orphan.json")

            $result = Repair-AgentOsState -RepositoryRoot $repoRoot
            $result.OrphanedTasks | Should -Contain "TASK-orphan.json"
            Test-Path -LiteralPath (Join-Path $paths.TasksActive "TASK-current.json") | Should -BeTrue
            Test-Path -LiteralPath (Join-Path $paths.Recovery "orphan-active-TASK-orphan.json") | Should -BeTrue
        }
    }
}

Describe "v0.8 lifecycle policy" {
    InModuleScope AgentOS {
        It "allows an idempotent same-phase transition" {
            $result = Test-AgentOsPhaseTransition -From "READY" -To "READY"
            $result.Allowed | Should -BeTrue
            $result.Idempotent | Should -BeTrue
        }

        It "rejects READY directly to COMPLETED" {
            $result = Test-AgentOsPhaseTransition -From "READY" -To "COMPLETED"
            $result.Allowed | Should -BeFalse
        }

        It "allows READY_TO_COMMIT to COMPLETED" {
            $result = Test-AgentOsPhaseTransition -From "READY_TO_COMMIT" -To "COMPLETED"
            $result.Allowed | Should -BeTrue
        }

        It "rejects verification in SCOPED phase" {
            $script:AgentOsOperationPolicy["verify"] | Should -Not -Contain "SCOPED"
        }
    }
}

Describe "v0.8 operation identity" {
    InModuleScope AgentOS {
        It "generates a stable operation key" {
            $a = Get-AgentOsOperationKey -RepositoryRoot "C:\repo" -Operation "verify" -Identity "full"
            $b = Get-AgentOsOperationKey -RepositoryRoot "C:\repo" -Operation "verify" -Identity "full"
            $a | Should -Be $b
        }

        It "changes the key when identity changes" {
            $a = Get-AgentOsOperationKey -RepositoryRoot "C:\repo" -Operation "verify" -Identity "fast"
            $b = Get-AgentOsOperationKey -RepositoryRoot "C:\repo" -Operation "verify" -Identity "full"
            $a | Should -Not -Be $b
        }
    }
}
