# HANDOFF — Aiven allowlist / Browser clean continuation

## Goal

Complete the remaining free Aiven Valkey acceptance safely: restore Codex
`@Browser` control in a fresh task, restrict inbound access to the current
Windows runtime-host egress `/32`, prove TLS connectivity after the change, and
only then remove both open-to-all CIDRs.

## Done

- Aiven project `ai-advisor` and free service `ai-advisor-valkey` exist.
- The console showed Valkey 9.1.1, one node, status `Running` on 2026-08-02.
- Secret-safe live acceptance already passed over TLS: SET NX PX, GETDEL, Lua,
  16-way concurrency and durable outbox deduplication; synthetic keys were
  deleted and the process variable plus clipboard were cleared.
- Managed backup evidence is accepted. The Backups page showed multiple
  completed 89-byte backups in `do-ams3`, including a visible record at
  2026-08-01 11:17:47 UTC.
- Two independent HTTPS reflectors returned the same runtime-host public IPv4.
  Its `/32` form was shown to the operator but deliberately not persisted in
  project files because it can change.
- Bundled `Browser` and `Chrome` plugins are installed and enabled at desktop
  app version `26.727.51351`. The old task did not expose the Browser skill,
  consistent with stale per-task plugin state after installation/update.
- Production widget visibility is enabled and independently accepted. It is
  unrelated to this Aiven continuation.

## Current Constraints

- Paid plans are excluded. Keep the service on the free single-node plan; do
  not select an upgrade, payment method or paid HA package.
- The Aiven IP filter is still assumed to contain `0.0.0.0/0` and `::/0` until
  the new task reads the real UI. Do not claim network closure before proof.
- First add the freshly rechecked runtime egress IPv4 as `/32` while preserving
  the two open ranges. Run a connection smoke. Remove the open ranges only
  after that smoke succeeds, then run the smoke again.
- Do not persist or print the full Aiven URI/password. Do not inspect browser
  cookies, local storage, saved passwords, `.env` or secrets.
- Telegram remains disabled, menu-only and AI-free. Anonymous order lookup and
  free-text Telegram order handling remain prohibited.
- Do not touch SalesDrive customer/order payloads, OpenCart/cPanel, Tunnel, DNS
  or unrelated runtime files.
- Preserve user-owned dirty/untracked files exactly: modified `AGENTS.md`;
  `.backup-key.dpapi`, `_backups/`, root `agent-os.ps1`, Agent OS docs/PDF,
  `modules/AgentOS/Private/Scope.ps1.bak`, and backup/restore scripts.
- Before this handoff savepoint, local `main` was ahead of `origin/main` by 10
  commits. Do not push without a new explicit command.

## Next Steps

1. Fully restart the Codex desktop app and start a new Codex task that explicitly
   invokes `@Browser`. If `@Browser` is absent, toggle/reinstall the bundled
   Browser plugin, restart again, and use `/feedback` only if a fresh task still
   cannot connect.
2. Run `git status --short` and `.\scripts\agent-os.ps1 task status`; read this
   handoff and `AGENTS.md` before any project or remote action.
3. Recheck the current public IPv4 from the Windows host that runs
   `F:\Services\AI Advisor`; do not reuse the prior address blindly.
4. In Aiven Service settings, add that IPv4 as `/32` while leaving
   `0.0.0.0/0` and `::/0` temporarily present.
5. Verify the Aiven Service URI uses TLS (`valkeys://` in the current console)
   without exposing it, and run the existing secret-safe Valkey smoke using a
   process-scoped value only.
6. After the first smoke passes, remove `0.0.0.0/0` and `::/0`, save, visually
   verify the final allowlist contains only the trusted `/32`, and rerun the
   smoke. Clear the process variable and clipboard afterward.
7. Update the readiness doc and `wiki/log.md`, complete the Agent OS task and
   commit only the narrow documentation/result scope. Do not push unless asked.

## Key Files

- `C:\AI Advisor\AGENTS.md`
- `C:\AI Advisor\wiki\log.md`
- `C:\AI Advisor\docs\ai-advisor-valkey-aiven-readiness.md`
- `C:\AI Advisor\scripts\validate-aiven-valkey-readiness.mjs`
- `C:\AI Advisor\infra\aiven\README.md`
- `C:\AI Advisor\wiki\synthesis\handoffs\HANDOFF_2026-08-02_AIVEN_BROWSER_CONTINUATION.md`

## Savepoint Notes

- Canonical pre-handoff HEAD: `be264aa` (`docs: record browser plugin diagnosis`).
- The handoff/savepoint commit containing this file becomes the next canonical
  continuation HEAD; confirm it with `git log -1 --oneline`.
- No Aiven setting, runtime state, secret, Telegram/SalesDrive operation or
  customer/order payload was changed while preparing this handoff.
