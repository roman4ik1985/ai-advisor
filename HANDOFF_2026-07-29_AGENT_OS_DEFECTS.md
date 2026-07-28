## HANDOFF

### Goal

Bring Agent OS 1.0 from the independently verified `64/90 PASS, 26 FAIL,
0 SKIPPED` state to a release-ready result. Start by reproducing the reported
defects against the current core and separating implementation defects from the
six stated test-expectation gaps.

### Done

- Core implementation is committed as `ddf0be9 Release Agent OS 1.0 core implementation`.
- Test plan is committed as `d2236ae Add independent Agent OS 1.0 test plan`.
- Earlier test handoff is committed as `5f6564e Add Agent OS 1.0 test handoff`.
- Independent test worktree: `C:\Users\roman\Downloads\agent-os-test-final`,
  detached at `3a78110`; its test code commit `60b9aa3` is a direct child of
  `ddf0be9`.
- Report confirms Windows PowerShell 5.1 + PowerShell 7.6.4, Pester 6.0.1,
  64/90 T01–T11 PASS and zero skips.
- Current main worktree has the updated independent report as a user-owned,
  uncommitted change. Do not overwrite or stage it in an implementation task.

### Current Constraints

- Do not change `tests/**`, `.github/workflows/**`,
  `docs/agent-os-1.0-test-plan.md`, or `docs/agent-os-test-results.md` in the
  implementation contour; the test agent owns them.
- Preserve the user-owned dirty baseline: `AGENTS.md`,
  `docs/agent-os-test-results.md`, backups, root `agent-os.ps1`, old Agent OS
  docs and backup scripts.
- Do not touch AI Advisor runtime, OpenCart/cPanel, Cloudflare Tunnel, `.env`,
  credentials, secrets, remote or `F:\Services\AI Advisor`.
- Do not use `git add .`, `git add -A`, reset/clean/force-push.

### Next Steps

1. Create a new Agent OS implementation task with an explicit core-only scope.
2. Reproduce D4-1.0b and D8-1.0 in isolated temporary Git repositories before
   patching: their report wording does not fully match the current code path.
3. Fix confirmed core defects in small commits:
   - D4/D6: empty arrays and scope-pattern validation;
   - D7: live lock protection during recovery;
   - D5: canonical, checkout-independent release hashes;
   - D9: protected filesystem inventory/fingerprint without exposing secret
     contents;
   - D4-1.0b/D8 only after targeted reproduction confirms the root cause.
4. Hand each implementation commit to the test agent for a fresh dual-shell
   T01–T11 run. Test expectation gaps are owned by the test agent.

### Key Files

- `C:\AI Advisor\AGENTS.md`
- `C:\AI Advisor\PROJECT_LOG.md`
- `C:\AI Advisor\docs\agent-os-1.0-test-plan.md`
- `C:\AI Advisor\docs\agent-os-test-results.md`
- `C:\AI Advisor\modules\AgentOS\Private\Manifest.ps1`
- `C:\AI Advisor\modules\AgentOS\Private\Scope.ps1`
- `C:\AI Advisor\modules\AgentOS\Public\Commit.ps1`
- `C:\AI Advisor\modules\AgentOS\Public\Doctor.ps1`
- `C:\AI Advisor\modules\AgentOS\Public\System.ps1`
- `C:\AI Advisor\scripts\install-agent-os.ps1`
- `C:\AI Advisor\RELEASE-MANIFEST.json`

### Savepoint Notes

- Handoff task: `TASK-2026-07-29-000234-557`.
- Savepoint will be created after this handoff is verified and committed.
- Before the next slice run `git status --short` and confirm there is no active
  Agent OS task.
