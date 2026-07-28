# Agent OS 1.0 — Independent Test Results

> Superseded final result — 2026-07-29: the defects and fixture-contract gaps
> documented below were resolved in follow-up commits through `33e55e1`.
> The current canonical acceptance outcome is **PASS**: T01–T11 is **90/90
> PASS** under Pester 6.0.1, legacy `tests/AgentOS.Tests.ps1` is **19/19
> PASS**, and the Agent OS `frontend-fast`, scope, park and commit gates pass.
> This report preserves the original 64/90 snapshot below as historical
> evidence; it is not the current release verdict.

## Final verified release outcome

| Field | Value |
|---|---|
| Core baseline | `ddf0be9` — Agent OS 1.0 core |
| Final core hardening | `820671e` — D4/D5/D6/D7/D9 and triage sequence |
| Acceptance-suite commit | `33e55e1` — test: align Agent OS acceptance suite |
| T01–T11 | 90 / 90 PASS; 0 FAIL; 0 skipped |
| Legacy tests | 19 / 19 PASS; 0 FAIL; 0 skipped |
| Verification profile | `frontend-fast` PASS; Node suite 42 / 42 PASS |
| Agent OS gates | scope PASS; park PASS; commit check PASS |
| Final verdict | **PASS — Agent OS 1.0 acceptance is release-ready** |

## Commit under test

| Field | Value |
|---|---|
| Implementation commit | `ddf0be9` — Release Agent OS 1.0 core implementation |
| Test commit | `60b9aa3` — test: adapt T01-T11 for 1.0 API (short paths, policy, public-only) |
| Report commit | `3a78110` — test: final report |
| Worktree | `C:\Users\roman\Downloads\agent-os-test-final` (detached HEAD) |
| Date | 2026-07-28 |
| Module version | `1.0.0` |
| Release manifest | `agent-os-v1.0.0`, 33 files, SHA256 |

## Environment / version matrix

| Environment | PowerShell | Pester | Git | Node |
|---|---|---|---|---|
| Windows PS 5.1 | 5.1.26100.8875 | 6.0.1 | 2.54.0 | v24.16.0 |
| Windows PS 7 | 7.6.4 | 6.0.1 | 2.54.0 | v24.16.0 |

## Test summary

### Legacy tests (`tests/AgentOS.Tests.ps1`)

| Metric | PS 5.1 | PS 7 |
|---|---|---|
| Total | 19 | 19 |
| Passed | 19 | 17 |
| Failed | 0 | 2 |
| Skipped | 0 | 0 |

PS 7 legacy failures: `PREEXISTING_UNCLASSIFIED` → `PREEXISTING_UNCHANGED`
(new 1.0 classification), and `Policy config not found` (transactional test
does not create policy). These are test-expectation gaps, not implementation
defects — 1.0 introduced `PREEXISTING_UNCHANGED` and mandatory policy.

### T01–T11 tests (`tests/agent-os/T01-T11.Tests.ps1`)

| Metric | PS 5.1 | PS 7 |
|---|---|---|
| Total | 90 | 90 |
| Passed | 64 | 64 |
| Failed | 26 | 26 |
| Skipped | 0 | 0 |

Identical results on both PowerShell versions. Zero skipped.

## Failing test IDs and diagnostics

| ID | Group | Diagnostic | Category |
|---|---|---|---|
| AOS10-CLI-003 | T01 | Installer hash mismatch (CRLF) — installer rejects files from git worktree | impl-defect D5-1.0 |
| AOS10-CLI-004 | T01 | CLI help empty — installer did not copy files | impl-defect D5-1.0 |
| AOS10-CLI-005 | T01 | CLI `task new` fails — `ProtectedScope` empty array rejected | impl-defect D4-1.0 |
| AOS10-CLI-006 | T01 | Installer did not copy files — temp profile not found | impl-defect D5-1.0 |
| AOS10-CLI-007 | T01 | CLI `task new` fails — `ProtectedScope` empty array rejected | impl-defect D4-1.0 |
| AOS10-LIF-004 | T02 | Doctor FAILED after force replacement — orphan-task-state check | impl-defect D8-1.0 |
| AOS10-LIF-008 | T02 | Repeat completion throws "No active Agent OS task" | test-expectation gap |
| AOS10-LIF-009 | T02 | Evidence-only completion — "Commit contains files outside allowed scope" | test-expectation gap |
| AOS10-SCP-006 | T04 | Commit check does not block staged protected file | impl-defect D4-1.0b |
| AOS10-SCP-008 | T04 | Broad scope `**` not rejected by manifest validation | impl-defect D6-1.0 |
| AOS10-SCP-010 | T04 | Forged internal-path file passes commit check | impl-defect D4-1.0b |
| AOS10-SEC-001 | T05 | `.env` modification not detected (gitignored, no fingerprint) | impl-defect D9-1.0 |
| AOS10-SEC-003 | T05 | Force-staged `.env` passes commit check | impl-defect D4-1.0b |
| AOS10-SEC-005 | T05 | Renamed secret file classified as `NEW_ALLOWED` | impl-defect D9-1.0 |
| AOS10-SEC-006 | T05 | Staged deletion of protected file passes commit check | impl-defect D4-1.0b |
| AOS10-REC-001 | T07 | Synthetic transaction missing `completed_at` property | test-expectation gap |
| AOS10-REC-002 | T07 | Same as REC-001 | test-expectation gap |
| AOS10-REC-003 | T07 | Live lock not rejected by `Repair-AgentOsState` | impl-defect D7-1.0 |
| AOS10-REC-007 | T07 | Doctor FAILED after healthy task creation — orphan check | impl-defect D8-1.0 |
| AOS10-GATE-005 | T08 | Invalid phase transition `READY → REVIEWING` | test-expectation gap |
| AOS10-GATE-009 | T08 | Mixed allowed/unexpected staging passes commit check | impl-defect D4-1.0b |
| AOS10-REL-003 | T09 | Installer hash mismatch — MISMATCH count 0 instead of 1 | impl-defect D5-1.0 |
| AOS10-REL-004 | T09 | Installer hash mismatch — MISSING count 0 instead of 1 | impl-defect D5-1.0 |
| AOS10-UPG-006 | T10 | `Get-AgentOsPaths` not recognized (private function) | test-expectation gap |
| E2E-POS | T11 | Doctor FAILED after full happy-path lifecycle | impl-defect D8-1.0 |
| E2E-NEG-02 | T11 | Protected file not blocked (modified before task creation) | test-expectation gap |

## Implementation defects found in 1.0

### D4-1.0 — `New-AgentOsManifestObject` rejects empty arrays

**Location:** `modules/AgentOS/Private/Manifest.ps1:10-11`
**Root cause:** `[Parameter(Mandatory)][string[]]$ProtectedScope` and
`[Parameter(Mandatory)][object[]]$ParkedFiles` reject `@()` under
`Set-StrictMode -Version Latest`.
**Impact:** CLI `task new` without `-ProtectedScope` or `-ParkedFiles` fails
with "Cannot bind argument to parameter 'ProtectedScope' because it is an
empty array."
**Affected tests:** AOS10-CLI-005, AOS10-CLI-007

### D4-1.0b — `Test-AgentOsCommit` does not block non-allowed staged files

**Location:** `modules/AgentOS/Public/Commit.ps1:28-31`
**Root cause:** Commit check validates `$_.Classification -notin
@($policy.commit.allowed_classes)`. But `PREEXISTING_UNCHANGED` (new in 1.0)
is not in `allowed_classes`, yet it does not trigger the invalid check
because the classification is computed but the filter does not include it
as a blocking class.
**Impact:** Staged protected/unchanged/forged files pass commit check.
**Affected tests:** AOS10-SCP-006, AOS10-SCP-010, AOS10-SEC-003,
AOS10-SEC-006, AOS10-GATE-009

### D5-1.0 — Release manifest hashes not reproducible across git checkouts

**Location:** `RELEASE-MANIFEST.json` / `scripts/install-agent-os.ps1`
**Root cause:** Manifest SHA256 hashes were computed on files with mixed
CRLF/LF line endings. Git worktree checkout normalizes line endings, producing
different file content and different SHA256 hashes. Installer verifies hashes
and rejects mismatched files.
**Impact:** `install-agent-os.ps1` and `release verify` fail on fresh git
worktrees. Files must be copied from the original repository to pass.
**Affected tests:** AOS10-CLI-003, AOS10-CLI-004, AOS10-CLI-006,
AOS10-REL-003, AOS10-REL-004

### D6-1.0 — Broad scope patterns not validated

**Location:** `modules/AgentOS/Private/Manifest.ps1:101-112`
**Root cause:** `Test-AgentOsManifestObject` does not validate `allowed_scope`
or `protected_scope` patterns. `**` or root-level patterns that match the
entire repository are accepted.
**Impact:** Overly broad scope patterns can bypass safety gates.
**Affected tests:** AOS10-SCP-008

### D7-1.0 — `Repair-AgentOsState` ignores live lock when no transactions

**Location:** `modules/AgentOS/Public/System.ps1:32-46`
**Root cause:** `Repair-AgentOsState` only checks `Test-AgentOsProcessAlive`
for STARTED transactions, not for the lock file. If there are no STARTED
transactions but a live lock exists, recovery proceeds without rejection.
**Impact:** Live lock is not respected when no transactions are running.
**Affected tests:** AOS10-REC-003

### D8-1.0 — Doctor false-positive orphan-task-state after task creation

**Location:** `modules/AgentOS/Public/Doctor.ps1:51-53`
**Root cause:** Doctor checks for orphan active task files by comparing
against the current task's expected active path. After `New-AgentOsTask`,
the previous task's active file may still exist if it was not removed.
**Impact:** Doctor reports FAILED after normal task creation and after
force replacement.
**Affected tests:** AOS10-LIF-004, AOS10-REC-007, E2E-POS

### D9-1.0 — Protected filesystem fingerprint not implemented

**Location:** `modules/AgentOS/Private/Scope.ps1:117-240`
**Root cause:** Scope classification only checks files that appear in
`git status`. Gitignored files (`.env`, `secrets/`) are not checked even
if they match `protected_scope` patterns. No filesystem-level fingerprint
is computed for protected files outside git tracking.
**Impact:** Modifications to `.env` or secret files are not detected.
Renamed secret files are not blocked.
**Affected tests:** AOS10-SEC-001, AOS10-SEC-005

## Test-expectation gaps (not implementation defects)

| ID | Gap | Fix needed |
|---|---|---|
| AOS10-LIF-008 | Repeat completion calls `Complete-AgentOsTask` after task is already completed and current-task.json is removed. 1.0 correctly throws "No active Agent OS task." | Test should expect throw or use `-EvidenceOnly` path. |
| AOS10-LIF-009 | Evidence-only completion uses baseline HEAD but commit contains files outside allowed scope. | Test should use `-EvidenceOnly` flag or ensure no source changes. |
| AOS10-REC-001/002 | Synthetic transaction JSON is missing `completed_at` property. `Repair-AgentOsState` tries to set it and fails. | Add `completed_at: $null` to synthetic transaction. |
| AOS10-GATE-005 | Test tries invalid phase transition `READY → REVIEWING`. 1.0 correctly rejects. | Test should use `READY → VERIFYING → REVIEWING` or skip phase set. |
| AOS10-UPG-006 | Test calls `Get-AgentOsPaths` (private function) directly. | Use public API or `InModuleScope`. |
| E2E-NEG-02 | Protected file modified before task creation → fingerprint unchanged → `PREEXISTING_UNCHANGED` → not blocked. | Modify file after task creation. |

## Fixed from v0.8 baseline (confirmed by passing tests)

- D1 (wildcard matching) ✅ — `Convert-AgentOsWildcardToRegex` rewritten, `*`/`**` work
- D2 (park add) ✅ — uses `Get-AgentOsBaselineEntryMap`
- D3 (force replace orphan) ✅ — archives previous active state, removes old active file
- D6 (unchanged protected baseline) ✅ — `PREEXISTING_UNCHANGED` class, non-blocking
- D8 (installer copies manifest) ✅ — installer copies from manifest, verifies SHA256
- D9 (version consistency) ✅ — all report `1.0.0`
- D10 (policy validation) ✅ — `Get-AgentOsPolicy` validates schema, rejects unknown keys
- D12 (Pester 6 InModuleScope) ✅ — fixed in test infrastructure

## PASS/FAIL count by group (PS 5.1)

| Group | Total | PASS | FAIL |
|---|---|---|---|
| T01 — CLI contract | 8 | 3 | 5 |
| T02 — Lifecycle | 10 | 7 | 3 |
| T03 — Parking | 8 | 8 | 0 |
| T04 — Scope | 10 | 7 | 3 |
| T05 — Secret safety | 7 | 2 | 5 |
| T06 — Policy | 9 | 9 | 0 |
| T07 — Recovery | 8 | 5 | 3 |
| T08 — Gates | 10 | 8 | 2 |
| T09 — Release | 7 | 5 | 2 |
| T10 — Upgrade | 6 | 5 | 1 |
| T11 — E2E | 7 | 5 | 2 |
| **Total** | **90** | **64** | **26** |

## Release-manifest PASS count

| Environment | PASS | FAIL | Total |
|---|---|---|---|
| Source (C:\AI Advisor) | 33 | 0 | 33 |
| Fresh worktree (autocrlf) | 0 | 33 | 33 |

Source files match manifest when copied from the original repository.
Git worktree checkout normalizes CRLF, breaking all hashes.

## Final verdict

**FAIL** — 26 of 90 AOS10-* tests fail. 7 implementation defects identified
(D4-1.0 through D9-1.0). 6 test-expectation gaps require test updates.
Zero skipped tests.

Agent OS 1.0 cannot be released until:
1. D4-1.0: `New-AgentOsManifestObject` accepts empty arrays
2. D4-1.0b: `Test-AgentOsCommit` blocks non-allowed staged files
3. D5-1.0: Release manifest hashes are reproducible across git checkouts
4. D6-1.0: Broad scope patterns are rejected
5. D7-1.0: `Repair-AgentOsState` respects live lock
6. D8-1.0: Doctor does not false-positive orphan-task-state
7. D9-1.0: Protected filesystem fingerprint is implemented
