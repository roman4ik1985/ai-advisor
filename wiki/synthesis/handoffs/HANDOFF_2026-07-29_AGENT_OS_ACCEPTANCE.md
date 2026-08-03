## Agent OS 1.0 acceptance handoff

### Goal

Record the post-defect-fix release decision against current Agent OS core
`c72d6f1` without changing the independent tests or their user-owned report.

### Completed implementation commits after the report baseline `ddf0be9`

- `88a6356` — record initial defect triage.
- `a2c4d30` — block forged root `.agent-os` artifacts.
- `9c1d3bd` — allow empty optional task arrays.
- `fba7d40` — reject broad allowed-scope masks.
- `30e8441` — protect recovery from live locks.
- `4b10619` — canonical UTF-8 LF release hashes.
- `c72d6f1` — inventory ignored protected filesystem files.

### Recovery and current health

- Recovered stale empty transaction `TX-20260729-004905-181-39884`; it had no
  backups and no created files.
- `agent-os doctor run` is now fully PASSED: no lock, no active task and zero
  unfinished transactions.
- User-owned dirty baseline remains unstaged and untouched.

### Fresh independent acceptance

Unmodified T01-T11 tests from
`C:\Users\roman\Downloads\agent-os-test-final\tests\agent-os` were run in
separate temporary Git fixtures containing current core `c72d6f1`:

| Shell | Total | Pass | Fail | Skipped | XML evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| Windows PowerShell 5.1 | 90 | 67 | 23 | 0 | `C:\AOSAcceptanceaa5df6e0\pester-result.xml` |
| PowerShell 7.6.4 | 90 | 67 | 23 | 0 | `C:\AOSAcceptanceb93261c8\pester-result.xml` |

This improves the historical `64/90 PASS, 26 FAIL` report, but it is not a
release-ready result.

### Remaining failures

Failures shared by both shells:

- `AOS10-CLI-003/004/006/007`.
- `AOS10-LIF-004/008/009`.
- `AOS10-SCP-006/010`.
- `AOS10-SEC-003/005/006`.
- `AOS10-REC-001/002/007`.
- `AOS10-GATE-005/009`.
- `AOS10-REL-003/004/007`.
- `AOS10-UPG-006`, `E2E-POS`, `E2E-NEG-02`.

Already evidence-backed test-contract gaps include repeat completion,
invalid lifecycle transition, synthetic transaction objects missing
`completed_at`, direct calls to private `Get-AgentOsPaths`, and tests that
expect an exception where the public command returns `Status=FAILED` with a
non-zero CLI exit code. `REL-007` also expects a raw file hash and must be
updated for the canonical UTF-8 LF hash contract.

The CLI installer cases, Doctor cases, D9 test fixture path and release
missing/mismatch cases need fresh targeted fixture triage before any further
core patch. Do not treat the legacy report wording alone as proof of a core
defect.

### Next step

Run targeted, isolated reproductions for the unresolved fixture-sensitive
groups above, then either make a narrow core fix or, if the runtime behavior
is correct, update the independently-owned test expectation only after that
boundary is explicitly authorized.

### Constraints

- Do not change `tests/**`, `.github/workflows/**`,
  `docs/agent-os-1.0-test-plan.md`, or `docs/agent-os-test-results.md` without
  explicit scope expansion.
- Preserve current user-owned dirty/untracked files.
- Do not touch runtime, OpenCart/cPanel, Tunnel, `.env`, secrets, remotes or
  `F:\Services\AI Advisor`.
