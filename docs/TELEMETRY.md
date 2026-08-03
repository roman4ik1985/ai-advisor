# Codex OpenTelemetry for AI Advisor

## Status

This package implements the repository side of a local Codex → OTLP/HTTP → OpenTelemetry Collector → JSONL → PowerShell aggregation pipeline. Independent acceptance is not part of implementation and must be performed by a separate testing subagent using `TELEMETRY_TEST_SPEC.md`.

## Architecture

- Codex exports logs, traces and metrics to `127.0.0.1:4318`.
- `otelcol-contrib` stores each signal in a separate rotating JSONL file under `logs/telemetry/raw`.
- `Update-ModelBudgetLog.ps1` normalizes available values into `logs/telemetry/normalized/model-budget-events.jsonl` and renders `logs/MODEL_BUDGET_LOG.md`.
- Prompts are disabled with `log_user_prompt = false`.
- Weekly subscription budget is not available as a confirmed OTel field. It remains `unavailable` unless a documented calibration is added, and must never be marked `measured`.

## Prerequisites

- Windows 10/11 x64.
- PowerShell 7 recommended.
- Codex CLI installed and authenticated.
- Internet access during Collector installation.
- A known `otelcol-contrib` release version. Do not install an unpinned `latest` build.

## Install

From `C:\AI Advisor`:

```powershell
pwsh -NoProfile -File .\scripts\telemetry\Install-Telemetry.ps1 -CollectorVersion <x.y.z>
```

The installer downloads the official Windows AMD64 archive and official checksums file, verifies SHA-256, installs into `tools\otelcol`, backs up `%USERPROFILE%\.codex\config.toml`, and merges the `[otel]` block.

The repository cannot modify a workstation's user config through GitHub alone. Run the installer on the target workstation and inspect its redacted result.

## Start, status, aggregate and stop

```powershell
pwsh -NoProfile -File .\scripts\telemetry\Start-Telemetry.ps1
pwsh -NoProfile -File .\scripts\telemetry\Get-TelemetryStatus.ps1
pwsh -NoProfile -File .\scripts\telemetry\Update-ModelBudgetLog.ps1 -Stage implement -ExecutionMode subagent
pwsh -NoProfile -File .\scripts\telemetry\Stop-Telemetry.ps1
```

Full rebuild:

```powershell
pwsh -NoProfile -File .\scripts\telemetry\Update-ModelBudgetLog.ps1 -Rebuild
```

Developer-only self-check:

```powershell
pwsh -NoProfile -File .\scripts\telemetry\Test-Telemetry.ps1
```

This self-check is not formal acceptance.

## Evidence rules

- `measured`: directly present in telemetry.
- `configured`: read from active settings or explicit invocation parameters.
- `estimated`: derived from a documented calibration.
- `unavailable`: no reliable value.

Missing token fields remain null/unavailable; they are not converted to zero. `speed` is not assumed to be `standard`. `weekly_budget_pct` is not measured by this implementation.

## Privacy

- Collector binds to loopback only.
- No external exporter is configured.
- `logs/` is already ignored by repository `.gitignore`.
- Raw telemetry may still contain tool-result data emitted by Codex. Treat raw files as sensitive and retain them only for the configured rotation period.
- Normalization does not copy prompt bodies or arbitrary tool-result bodies into Markdown.
- Never use real secrets in acceptance tests; use synthetic markers.

## Rollback

1. Stop Collector.
2. Restore the timestamped `%USERPROFILE%\.codex\config.toml.backup-*` file.
3. Restart Codex so the restored configuration is loaded.
4. Remove `tools\otelcol` and local `logs\telemetry` only if the evidence is no longer needed.

## Known implementation limits

- Repository work cannot confirm the installed workstation Codex/PowerShell/Windows versions.
- The Collector config must be validated against the pinned installed version; component schemas can change.
- The normalizer uses defensive key discovery because Codex event schemas may evolve. Independent tests must verify actual event names and attributes produced by the installed Codex version.
- Tool-call counting and final result classification remain unavailable unless the observed telemetry supplies stable identifiers that can be mapped without double counting.
- Runtime installation, actual Codex turn generation, flush behavior, rotation, secret redaction and rollback require independent workstation testing.

## Official references to verify at execution time

- OpenAI Codex configuration reference and advanced configuration.
- OpenTelemetry Collector configuration and security guidance.
- OpenTelemetry Collector Contrib file exporter documentation.
- OpenTelemetry Collector Releases checksums for the pinned version.
