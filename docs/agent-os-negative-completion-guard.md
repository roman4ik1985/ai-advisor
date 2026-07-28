# Agent OS negative completion guard evidence

Task `TASK-2026-07-28-201250` uses this documentation-only change as the exact
staged payload for verifying completion guards after a prior task was completed.

The task must reject both a nonexistent commit hash and an empty commit hash
before it can complete with this file's valid commit hash.
