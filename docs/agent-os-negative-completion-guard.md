# Agent OS negative completion guard evidence

Task `TASK-2026-07-28-201250` uses this documentation-only change as the exact
staged payload for verifying completion guards after a prior task was completed.

The task must reject both a nonexistent commit hash and an empty commit hash
before it can complete with this file's valid commit hash.
# Evidence-only operational completion

An operational task that makes no source changes may complete without staging unrelated work only when all of the following are true:

1. `scope check`, `park check`, and the required verification profile have passed.
2. `commit check -AllowNoStagedFiles` has passed and records `EVIDENCE_ONLY` mode.
3. `task complete -CommitHash <task-baseline-hash> -EvidenceOnly` is used. Any other commit hash is rejected.

The completion record stores an empty commit-file list and `EVIDENCE_ONLY` mode. This exception never applies to `SOURCE_CHANGE` tasks.
