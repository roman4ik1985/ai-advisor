# HANDOFF — Direct SalesDrive live final savepoint

## Goal

Continue `AI Advisor` from the completed production-ready direct SalesDrive live-data contour without reopening already accepted routing, freshness, payment, runtime or Agent OS work.

## Done

- Agent OS 1.0 remains release-ready:
  - T01–T11: 90/90 PASS.
  - Legacy suite: 19/19 PASS.
- Agent OS v2 Lite request pipeline is active:
  - deterministic `SIMPLE` / `STANDARD` / `COMPLEX` / `ESCALATE` routing;
  - explicit live evidence and validator actions;
  - independent verification only for the risk-gated complex path.
- Direct server-side SalesDrive integration is released:
  - HTTPS-only bounded YML for product identity, price and explicit stock;
  - GET-only API dictionaries for delivery and payment methods;
  - no ERP intermediary.
- Deterministic RU/UK live responses are accepted for:
  - exact price;
  - exact availability;
  - delivery methods without deadline promises;
  - payment methods without approval/order-applicability promises;
  - combined payment and delivery;
  - confident product full-name/SKU matching and ambiguity clarification.
- Freshness is fail-closed:
  - explicit `FRESH` / `STALE` / `UNAVAILABLE`;
  - stale YML remains internal diagnostic last-known-good only;
  - stale products do not enter public catalog, model facts or renderer;
  - required stale/unavailable evidence returns manager fallback without an AI call;
  - validator enforces a ten-minute live timestamp.
- Dictionary labels are bounded and stripped of HTML/control characters before rendering.
- Public `/api/chat` success keys remain unchanged:
  - `answer`
  - `catalog`
  - `catalogDiagnostics`
  - `knowledge`
  - `provider`
- Final source verification: 69/69 PASS.
- Final redacted runtime acceptance:
  - freshness package: 4/4 PASS;
  - payment package: 3/3 PASS;
  - source/runtime release diff: 0;
  - local/public health: HTTP 200;
  - active API PID at handoff: 29552;
  - boundary-aware scan of 13 runtime logs: 0 secret/YML markers.

## Current constraints

- Preserve the remaining user-owned dirty/untracked baseline exactly:
  - `AGENTS.md`;
  - `.backup-key.dpapi`;
  - `_backups/`;
  - root `agent-os.ps1`;
  - local Agent OS docs/PDF;
  - `modules/AgentOS/Private/Scope.ps1.bak`;
  - backup/restore scripts.
- Do not use `git add .`, `git add -A`, `git reset --hard`, `git clean -fd` or force push.
- Do not touch runtime, `F:\Services\AI Advisor`, `.env`, secrets, SalesDrive customer/order payloads, OpenCart/cPanel, Tunnel or remote without an explicit new command.
- Do not enable anonymous order lookup. Personal order status requires a separately approved ownership/auth contract and a narrow DTO that never sends raw customer data to the model.
- No active implementation task should remain after this handoff.

## Next steps

1. Start only from a newly requested contour; first run `git status --short` and `.\scripts\agent-os.ps1 task status`.
2. If order status is selected, begin with a design-only ownership/auth contract. Do not call order APIs or access customer data in that slice.
3. Otherwise choose a separate bounded product/knowledge/UI contour and create a new Agent OS task with exact AllowedScope.

## Key files

- `C:\AI Advisor\AGENTS.md`
- `C:\AI Advisor\wiki\log.md`
- `C:\AI Advisor\README.md`
- `C:\AI Advisor\wiki\synthesis\specifications\TECHNICAL_SPECIFICATION.md`
- `C:\AI Advisor\docs\ai-advisor-direct-salesdrive-live-acceptance.md`
- `C:\AI Advisor\docs\ai-advisor-salesdrive-readonly-audit.md`
- `C:\AI Advisor\intent-router.mjs`
- `C:\AI Advisor\live-resolvers.mjs`
- `C:\AI Advisor\live-response-renderer.mjs`
- `C:\AI Advisor\request-pipeline.mjs`
- `C:\AI Advisor\response-validator.mjs`
- `C:\AI Advisor\salesdrive-yml.mjs`
- `C:\AI Advisor\salesdrive-api.mjs`
- `C:\AI Advisor\scripts\release-active-runtime.ps1`

## Savepoint notes

- Agent OS savepoint: `SP-2026-07-29-061310`.
- Continuation base before this handoff: `99d8f26`.
- Payment implementation: `c6e6f71`.
- Payment runtime acceptance: `99d8f26`.
- Freshness implementation: `0f830a6`.
- Freshness runtime acceptance: `b7b0348`.
- Bilingual hardening acceptance: `e64a9d0`.
- The handoff/savepoint commit containing this file is the required clean continuation point.
