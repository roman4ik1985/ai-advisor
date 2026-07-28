# Agent OS 1.0 — independent test plan

## Purpose

This document defines the tests required before Agent OS can be released as
`1.0.0`. A separate test agent owns test implementation and execution. The
implementation agent must not edit the test suite, CI workflow, or test results.

Current baseline:

- module version: `0.8.0`;
- historical plan: 62 scenarios, 60 PASS and 2 SKIPPED;
- current known defects: broken `park add`, orphan state after `task new -Force`,
  unchanged baseline files blocked by broad `ProtectedScope`, stale/untracked
  release package, and non-reproducible Pester 6 environment;
- AI Advisor runtime, OpenCart, Cloudflare Tunnel, `.env`, credentials and
  production services are outside this test contour.

## Ownership and allowed scope

The test agent may change:

- `tests/AgentOS.Tests.ps1`;
- additional Agent OS test fixtures under `tests/agent-os/**`;
- `.github/workflows/agent-os.yml`;
- `docs/agent-os-test-results.md`;
- a generated test evidence file explicitly agreed for this contour.

The test agent must not change:

- `modules/AgentOS/**`;
- `scripts/agent-os.ps1`;
- `scripts/install-agent-os.ps1`;
- `.agent-os/config/**`;
- `.agent-os/templates/**`;
- `RELEASE-MANIFEST.json`;
- application/runtime files, `.env`, secrets, OpenCart, cPanel or Tunnel state.

All destructive, crash-recovery and secret tests must use a newly created
temporary Git repository. Never use `C:\AI Advisor`, `F:\Services\AI Advisor`
or a real user PowerShell profile as the mutation target.

## Required environments

Run the suite in both:

1. Windows PowerShell 5.1;
2. PowerShell 7.x.

Both environments must use an explicitly provisioned Pester 6 version. The
test report must record exact PowerShell, Pester, Git and Node versions.

## Test groups

### T01 — module and CLI contract

| ID | Scenario | Expected result |
|---|---|---|
| AOS10-CLI-001 | Import module manifest | Import succeeds; exported functions match the manifest |
| AOS10-CLI-002 | Run `scripts/agent-os.ps1 help` | Exit 0; output identifies Agent OS 1.0 |
| AOS10-CLI-003 | Install into a clean temporary repository | Only release-package files are copied |
| AOS10-CLI-004 | Invoke installed CLI from another directory | Correct repository is used and caller directory is restored |
| AOS10-CLI-005 | Forward title, goal, scope, risk and switch arguments | Values arrive unchanged |
| AOS10-CLI-006 | Install alias twice | Profile entry remains idempotent; no duplicate alias |
| AOS10-CLI-007 | Missing Git repository | Controlled error; no files created outside target |
| AOS10-CLI-008 | Version consistency | CLI, installer, module and release manifest all report `1.0.0` |

This group closes historical `CLI-001`.

### T02 — task lifecycle and force replacement

| ID | Scenario | Expected result |
|---|---|---|
| AOS10-LIF-001 | Create a valid task | One current pointer and one matching active-state file |
| AOS10-LIF-002 | Create a second task without `-Force` | Rejected; original task remains unchanged |
| AOS10-LIF-003 | Replace a task with `-Force` | Previous task is archived/recovered atomically |
| AOS10-LIF-004 | Doctor immediately after force replacement | PASS; no orphan active-state file |
| AOS10-LIF-005 | Invalid lifecycle transition | Rejected without partial state mutation |
| AOS10-LIF-006 | Complete with valid source commit | Completion record is written once |
| AOS10-LIF-007 | Complete with invalid or empty hash | Rejected; task stays active |
| AOS10-LIF-008 | Repeat completion with same commit | Idempotent result |
| AOS10-LIF-009 | Evidence-only completion with baseline hash | Accepted only after all evidence-only gates |
| AOS10-LIF-010 | Evidence-only completion with another hash | Rejected |

### T03 — parking and baseline fingerprints

| ID | Scenario | Expected result |
|---|---|---|
| AOS10-PRK-001 | Park a dirty baseline file | File is added with reason and baseline fingerprint |
| AOS10-PRK-002 | Park the same file twice | No duplicate parked entry |
| AOS10-PRK-003 | Park a file absent from baseline | Controlled rejection |
| AOS10-PRK-004 | Remove parked file | Entry removed without changing the file |
| AOS10-PRK-005 | Unchanged parked file | `park check` PASS |
| AOS10-PRK-006 | Modify parked file after task creation | `PARKED_DRIFT`, gate fails |
| AOS10-PRK-007 | Delete parked file after task creation | Drift detected |
| AOS10-PRK-008 | Restore exact baseline bytes | Drift clears |

`AOS10-PRK-001` must fail against the old implementation that references the
missing `Get-AgentOsBaselineMap`.

### T04 — AllowedScope and ProtectedScope

| ID | Scenario | Expected result |
|---|---|---|
| AOS10-SCP-001 | New file inside AllowedScope | `NEW_ALLOWED` |
| AOS10-SCP-002 | Dirty baseline file inside AllowedScope | `PREEXISTING_ALLOWED` |
| AOS10-SCP-003 | New file outside AllowedScope | `NEW_UNEXPECTED`, gate fails |
| AOS10-SCP-004 | Unchanged baseline file matching ProtectedScope | Non-blocking protected-baseline classification |
| AOS10-SCP-005 | Modify protected baseline file | `PROTECTED`, gate fails |
| AOS10-SCP-006 | Stage protected file | Commit check fails |
| AOS10-SCP-007 | Protected and allowed patterns both match changed file | Protected wins |
| AOS10-SCP-008 | Broad or repository-root scope mask | Manifest validation rejects it |
| AOS10-SCP-009 | Agent OS-generated evidence/state files | `AGENT_INTERNAL` |
| AOS10-SCP-010 | Manually forged internal-path file | Cannot authorize a source commit |

### T05 — ignored files and secret safety

| ID | Scenario | Expected result |
|---|---|---|
| AOS10-SEC-001 | Modify ignored `.env` during task | Change detected by protected filesystem fingerprint |
| AOS10-SEC-002 | Restore exact `.env` bytes | Protected drift clears |
| AOS10-SEC-003 | Force-stage `.env` | Commit check blocks it |
| AOS10-SEC-004 | Add file under `secrets/**` | Scope/commit gate blocks it |
| AOS10-SEC-005 | Rename secret-like file into AllowedScope | Still blocked by protected-source evidence |
| AOS10-SEC-006 | Stage deletion of protected file | Blocked |
| AOS10-SEC-007 | Evidence and diagnostics | No secret value or file content is printed |

Use synthetic fixture values only. The suite must never open or print the real
project `.env`. This group closes historical `AOS-017`.

### T06 — policy configuration

Every retained property in `.agent-os/config/policy.json` requires one positive
and one negative contract test. Unsupported properties must be rejected during
initialization or manifest validation rather than silently ignored.

Minimum required contracts:

| ID | Policy area | Expected result |
|---|---|---|
| AOS10-POL-001 | Invalid schema/version/type | Controlled validation error |
| AOS10-POL-002 | Parking immutability and drift flag | Runtime behavior follows configured value |
| AOS10-POL-003 | Fingerprint algorithm | Supported value works; unsupported value rejected |
| AOS10-POL-004 | Commit allowed classes | Commit gate uses configured classes |
| AOS10-POL-005 | Lock timeout | Stale/live lock behavior follows configured timeout |
| AOS10-POL-006 | Transaction backup/rollback | Enabled behavior is proven; disabled behavior is explicit |
| AOS10-POL-007 | Auto-recovery | Behavior is deterministic and documented |
| AOS10-POL-008 | Lifecycle strictness | Invalid operations/transitions follow policy |
| AOS10-POL-009 | Audit retention | Retention boundary is enforced in a temporary clock-controlled fixture |

If an implementation decision removes a policy property, the test agent should
replace its behavioral test with a schema-rejection test.

### T07 — transactions, recovery and doctor

| ID | Scenario | Expected result |
|---|---|---|
| AOS10-REC-001 | Interrupted state write | Transaction remains recoverable |
| AOS10-REC-002 | Recover stale transaction | Original files restored and transaction marked rolled back |
| AOS10-REC-003 | Recover transaction owned by live process without force | Rejected |
| AOS10-REC-004 | Recover with explicit force | Recovery completes and is audited |
| AOS10-REC-005 | Orphan active-task JSON | Doctor fails and names exact task |
| AOS10-REC-006 | Recover orphan task | File moved to recovery; no current task lost |
| AOS10-REC-007 | Healthy completed lifecycle | Doctor PASS with no lock/transaction/task errors |
| AOS10-REC-008 | Re-run recovery | Idempotent; no additional corruption or deletion |

### T08 — verification and commit gates

| ID | Scenario | Expected result |
|---|---|---|
| AOS10-GATE-001 | Known verification profile | Configured commands run and evidence is saved |
| AOS10-GATE-002 | Unknown profile | Controlled rejection with available profile names |
| AOS10-GATE-003 | Command timeout | Process terminates and gate fails |
| AOS10-GATE-004 | Verification command failure | Failure code/log retained; commit remains blocked |
| AOS10-GATE-005 | Commit check before verification | Blocked |
| AOS10-GATE-006 | Commit check with no staged files | Blocked in source-change mode |
| AOS10-GATE-007 | Explicit evidence-only empty staging | Accepted only with required switch |
| AOS10-GATE-008 | Exact allowed staged files | Accepted |
| AOS10-GATE-009 | Mixed allowed/unexpected staging | Entire commit blocked |
| AOS10-GATE-010 | `git add .` or `git add -A` policy check | Forbidden commands remain documented and unused by helpers |

### T09 — release package integrity

| ID | Scenario | Expected result |
|---|---|---|
| AOS10-REL-001 | Enumerate release manifest | Every entry exists and is tracked by Git |
| AOS10-REL-002 | Run `release verify` on source package | All entries PASS |
| AOS10-REL-003 | Modify one packaged fixture file | Exactly that entry reports `MISMATCH` |
| AOS10-REL-004 | Remove one packaged fixture file | Exactly that entry reports `MISSING` |
| AOS10-REL-005 | Inspect package contents | No state, evidence, logs, backup, `.env` or credential files |
| AOS10-REL-006 | Install from a clean clone/archive | Module, CLI, config and templates operate without source-only files |
| AOS10-REL-007 | Rebuild manifest twice from identical tree | Deterministic file list and hashes |

### T10 — upgrade compatibility

| ID | Scenario | Expected result |
|---|---|---|
| AOS10-UPG-001 | Upgrade clean v0.8 installation | Commands and config migrate to 1.0 |
| AOS10-UPG-002 | Upgrade with parked files | Paths/reasons/fingerprints preserved |
| AOS10-UPG-003 | Upgrade with completed evidence | Historical evidence remains readable |
| AOS10-UPG-004 | Upgrade with active task | Explicit safe result: migrate atomically or refuse without mutation |
| AOS10-UPG-005 | Re-run upgrade | Idempotent |
| AOS10-UPG-006 | Unsupported legacy schema | Controlled refusal with recovery guidance |

### T11 — full end-to-end acceptance

Run in a fresh temporary repository in both PowerShell environments:

1. install Agent OS 1.0;
2. initialize config and templates;
3. create a task with allowed, protected and parked paths;
4. make one allowed change and retain one unrelated baseline change;
5. pass manifest, scope and parking gates;
6. run verification;
7. explicitly stage the allowed file;
8. pass commit check;
9. create a real commit;
10. complete the task with its exact hash;
11. confirm audit/evidence/completion records;
12. confirm final doctor PASS;
13. confirm `release verify` PASS.

Repeat negative E2E variants for unexpected file, protected file, parked drift,
failed verification, wrong commit hash and interrupted transaction.

## CI acceptance

The Windows CI workflow must:

- run on pull requests and pushes affecting Agent OS package/test paths;
- execute PowerShell 5.1 and PowerShell 7 jobs;
- provision a pinned Pester 6 version;
- run the complete Pester suite with a machine-readable result;
- run `npm test`;
- run Agent OS doctor and package release verification in an isolated fixture;
- fail on any failed, blocked or skipped required test;
- upload only non-secret test evidence.

## Required evidence

The test agent must update `docs/agent-os-test-results.md` with:

- commit hash under test;
- environment/version matrix;
- PASS/FAIL/SKIPPED count by group;
- exact failing IDs and concise diagnostics;
- clean-install and upgrade fixture paths;
- CI run link or local CI-equivalent command output;
- release-manifest PASS count;
- final verdict: `PASS`, `FAIL` or `BLOCKED`.

Do not mark Agent OS 1.0 ready if any required test is skipped.

## Release acceptance criteria

Agent OS may be called `1.0.0` only when:

1. all historical 62 scenarios pass with zero skipped;
2. every required `AOS10-*` test above passes in both PowerShell environments;
3. clean install and supported upgrade paths pass;
4. `doctor` and `release verify` pass in the clean installed package;
5. all release files are tracked and the manifest is current;
6. no secret, runtime state, evidence, log or backup file enters the package;
7. implementation and independent-test commits are separately reviewable;
8. the final version/tag is created only after the independent test verdict.

