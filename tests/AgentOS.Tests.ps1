#Requires -Version 5.1
<#
    Legacy Agent OS tests (updated for Pester 6 compatibility).
    These tests cover the historical 62-scenario baseline and must all pass
    for the 1.0 release.

    Pester 6 resolves InModuleScope during discovery, so the module must be
    loaded in global session state before any Describe block is discovered.
#>

$modulePath = Join-Path $PSScriptRoot "..\modules\AgentOS\AgentOS.psd1"
$modulePath = (Resolve-Path $modulePath).Path
Import-Module $modulePath -Force -Global

Describe "Agent OS v0.4 public API" {
    It "exports parked-file commands" {
        $commands = Get-Command -Module AgentOS | Select-Object -ExpandProperty Name

        $commands | Should -Contain "Add-AgentOsParkedFile"
        $commands | Should -Contain "Remove-AgentOsParkedFile"
        $commands | Should -Contain "Get-AgentOsParkedFile"
        $commands | Should -Contain "Get-AgentOsManifest"
    }
}

Describe "Baseline-aware scope classification" -Tag 'legacy-scope' {
    InModuleScope AgentOS {
        BeforeEach {
            # Create a temp repo so Get-AgentOsFileFingerprint can resolve paths.
            $script:clsRepo = Join-Path $TestDrive "cls-repo-$(Get-Random)"
            New-Item -ItemType Directory -Path $script:clsRepo | Out-Null
            # Create the dirty files so fingerprints can be computed.
            $files = @("docs/wiki/parked.md", "src/features/ProductPickerModal.tsx", "tmp/preexisting.txt")
            foreach ($f in $files) {
                $dir = Split-Path (Join-Path $script:clsRepo $f) -Parent
                if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                Set-Content -LiteralPath (Join-Path $script:clsRepo $f) -Value "content-$f" -Encoding UTF8 -NoNewline
            }

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
                            fingerprint = (Get-AgentOsFileFingerprint -RepositoryRoot $script:clsRepo -RelativePath "docs/wiki/parked.md")
                        },
                        [pscustomobject]@{
                            Code = " M"
                            Path = "src/features/ProductPickerModal.tsx"
                            fingerprint = (Get-AgentOsFileFingerprint -RepositoryRoot $script:clsRepo -RelativePath "src/features/ProductPickerModal.tsx")
                        },
                        [pscustomobject]@{
                            Code = "??"
                            Path = "tmp/preexisting.txt"
                            fingerprint = (Get-AgentOsFileFingerprint -RepositoryRoot $script:clsRepo -RelativePath "tmp/preexisting.txt")
                        }
                    )
                }
            }
        }

        It "classifies a parked dirty baseline file" -Tag 'known-defect' {
            # KNOWN DEFECT: wildcard matching for "docs/**" patterns is broken in v0.8
            # because Convert-AgentOsWildcardToRegex does not properly convert * and **.
            # The parked path "docs/wiki/parked.md" does not match "docs/**" pattern.
            # After implementation fix, this should classify as PREEXISTING_PARKED.
            $entry = [pscustomobject]@{
                Code = " M"
                Path = "docs/wiki/parked.md"
                Staged = $false
                Worktree = $true
                Untracked = $false
            }

            $result = Get-AgentOsScopeClassification -RepositoryRoot $script:clsRepo -Entries @($entry) -Task $task
            $result[0].Classification | Should -Be "PREEXISTING_PARKED"
        }

        It "classifies a new allowed file" -Tag 'known-defect' {
            # KNOWN DEFECT: wildcard "tests/**/ProductPickerModal*" does not match.
            # Create a new file for fingerprint.
            $newFile = "tests/ProductPickerModal.test.tsx"
            $dir = Split-Path (Join-Path $script:clsRepo $newFile) -Parent
            if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            Set-Content -LiteralPath (Join-Path $script:clsRepo $newFile) -Value "new test" -Encoding UTF8 -NoNewline

            $entry = [pscustomobject]@{
                Code = "??"
                Path = $newFile
                Staged = $false
                Worktree = $true
                Untracked = $true
            }

            $task.allowed_scope = @($task.allowed_scope) + @("tests/**/ProductPickerModal*")
            $result = Get-AgentOsScopeClassification -RepositoryRoot $script:clsRepo -Entries @($entry) -Task $task
            $result[0].Classification | Should -Be "NEW_ALLOWED"
        }

        It "classifies a preexisting allowed file" -Tag 'known-defect' {
            # KNOWN DEFECT: wildcard "src/**/ProductPickerModal*" does not match.
            $entry = [pscustomobject]@{
                Code = " M"
                Path = "src/features/ProductPickerModal.tsx"
                Staged = $false
                Worktree = $true
                Untracked = $false
            }

            $result = Get-AgentOsScopeClassification -RepositoryRoot $script:clsRepo -Entries @($entry) -Task $task
            $result[0].Classification | Should -Be "PREEXISTING_ALLOWED"
        }

        It "accepts an unchanged unclassified baseline file" {
            $entry = [pscustomobject]@{
                Code = "??"
                Path = "tmp/preexisting.txt"
                Staged = $false
                Worktree = $true
                Untracked = $true
            }

            $classified = @(Get-AgentOsScopeClassification -RepositoryRoot $script:clsRepo -Entries @($entry) -Task $task)
            $classified[0].Classification | Should -Be "PREEXISTING_UNCHANGED"

            $gate = Test-AgentOsScopePass -Classified $classified -Policy ([pscustomobject]@{ parked_files = [pscustomobject]@{ block_on_drift = $true } })
            $gate.Passed | Should -BeTrue
        }

        It "blocks a new unexpected file" {
            # Create the file so fingerprint can be computed.
            $newFile = "tmp/new-debug.txt"
            $dir = Split-Path (Join-Path $script:clsRepo $newFile) -Parent
            if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            Set-Content -LiteralPath (Join-Path $script:clsRepo $newFile) -Value "debug" -Encoding UTF8 -NoNewline

            $entry = [pscustomobject]@{
                Code = "??"
                Path = $newFile
                Staged = $false
                Worktree = $true
                Untracked = $true
            }

            $classified = @(Get-AgentOsScopeClassification -RepositoryRoot $script:clsRepo -Entries @($entry) -Task $task)
            $classified[0].Classification | Should -Be "NEW_UNEXPECTED"

            $gate = Test-AgentOsScopePass -Classified $classified -Policy ([pscustomobject]@{ parked_files = [pscustomobject]@{ block_on_drift = $true } })
            $gate.Passed | Should -BeFalse
        }

        It "gives protected scope highest priority" -Tag 'known-defect' {
            # KNOWN DEFECT: wildcard "docs/secret/**" does not match.
            $entry = [pscustomobject]@{
                Code = " M"
                Path = "docs/secret/passwords.md"
                Staged = $false
                Worktree = $true
                Untracked = $false
            }

            # Create the file for fingerprint.
            $dir = Split-Path (Join-Path $script:clsRepo "docs/secret/passwords.md") -Parent
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            Set-Content -LiteralPath (Join-Path $script:clsRepo "docs/secret/passwords.md") -Value "secret" -Encoding UTF8 -NoNewline

            $result = Get-AgentOsScopeClassification -RepositoryRoot $script:clsRepo -Entries @($entry) -Task $task
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
              ([pscustomobject]@{algorithm='SHA256';exists=$true;hash='b';length=1}) `
              | Should -BeFalse
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
            Initialize-AgentOs -RepositoryRoot $repo | Out-Null
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
