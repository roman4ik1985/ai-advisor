# Agent OS 1.0 — handoff to independent test agent

## Goal

Independently implement and run the Agent OS 1.0 test plan against the completed
core implementation. Deliver a pass/fail verdict and test evidence without
modifying implementation files.

## Starting point

- implementation commit: `ddf0be9 Release Agent OS 1.0 core implementation`;
- test-plan commit: `d2236ae Add independent Agent OS 1.0 test plan`;
- module/CLI/installer version: `1.0.0`;
- release package: 33 SHA256-verified files; `release verify` passed before
  the implementation commit;
- existing AI Advisor regression profile: 42/42 passed;
- `doctor run` passed after the implementation task completed.

## What changed

- `park add` now uses the actual baseline-map helper; parking supports
  policy-controlled immutability.
- `task new -Force` archives the previous active state and removes its active
  JSON before replacing the current pointer; task IDs include milliseconds.
- unchanged pre-existing files, including broad ProtectedScope matches, no
  longer block a task; a changed protected file still blocks it.
- policy is parsed and validated rather than ignored. Unsupported keys and
  unsupported values fail in a controlled way.
- lock timeout, parked-drift behavior, commit allowed classes and audit
  retention follow the policy contract.
- CLI resolves its repository from the installed script location and supports
  running from another working directory.
- installer copies only files named by `RELEASE-MANIFEST.json`, verifies their
  SHA256 hashes, and adds its optional alias idempotently.
- `.agent-os` state, evidence, logs, task state and savepoints are ignored;
  versioned config/template files are tracked package content.

## Test-agent scope

May change only:

- `tests/AgentOS.Tests.ps1`;
- `tests/agent-os/**` fixtures;
- `.github/workflows/agent-os.yml`;
- `docs/agent-os-test-results.md`;
- a separately agreed generated test-evidence file.

Do not change `modules/AgentOS/**`, `scripts/**`, `.agent-os/config/**`,
`.agent-os/templates/**`, `RELEASE-MANIFEST.json`, application/runtime files,
secrets, OpenCart, cPanel, Tunnel or `F:\Services\AI Advisor`.

Use a separate Git worktree/branch and newly created temporary Git repositories
for all destructive, recovery and secret tests. Do not use this repository as
a mutation fixture.

## Required execution

Use the canonical plan:

- `docs/agent-os-1.0-test-plan.md`;
- run every group T01–T11 on Windows PowerShell 5.1 and PowerShell 7.x;
- provision and record an explicit Pester 6 version;
- include clean-install/upgrade and CI checks;
- write final evidence to `docs/agent-os-test-results.md`.

Known historical skips `AOS-017` and `CLI-001` are release blockers: final
report must have zero skipped scenarios. Treat a failure as a defect report;
do not patch core implementation in this test contour.

## Current readiness

Testing may start immediately against `ddf0be9`. Final Agent OS 1.0 release
approval requires the independent report to pass in both PowerShell versions,
with all required scenarios executed and no skips.
