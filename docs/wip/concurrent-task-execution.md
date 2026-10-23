# Concurrent Task Execution in a Factory Session

## Status: EVALUATION

A factory session runs one task at a time. While one long step runs (a multi-GB upload, a long transcription), every other station on that location waits, the session stops polling, and the orchestrator times out runs queued behind it. This WIP records how the session works today, the evidence that it now hurts, the constraints any fix must keep, and the options for letting stations share the session so one station can't block the rest.

Standards read: `principles/solve-problems-you-have-seen.md`, `principles/try-it-to-decide.md`, `principles/abstraction-earns-its-keep.md`, `git-workflow/wip-files.md`. Related decision: orchestrator `docs/decisions/0001-one-active-worker-session-per-location.md` (D1).

---

## How It Works Today

### The session loop (`src/factory.js`)

```js
while (true) {
  const task = await pollForTask();             // GET /api/factory/poll
  if (task) await executeTask(task, getHandler); // runs the step to the end
  await sleep(pollInterval);                     // POLL_INTERVAL_MS, default 2000
}
```

- **One task at a time.** `executeTask` is awaited, so the next poll happens only after the current step returns.
- **No polling while a step runs.** Polling is also the session's heartbeat (the poll updates `factory_sessions.last_seen_at`), so a long step means a silent session.
- Steps are mostly I/O (`execa` child processes, `fetch`, file copies). Node's event loop is idle during those awaits, which is why the timers below keep working. **The bottleneck is the serial loop, not the CPU.**

### What keeps running during a long step

`startBinWatcher()` and `startIntakeWatcher()` run on `setInterval` (10 s). They are independent of the poll loop, so during a long step they still see full bins and call the orchestrator to **create** runs. Those runs just can't be **executed** until the loop is free.

### The orchestrator side (`apps/orchestrator.assemblyline.sh`)

- **Claim order:** `GET /api/factory/poll` claims the oldest `pending` step for the session's `(org, location)`: `ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED` (`src/app/api/factory/poll/route.js`). FIFO across all stations at the location; each poll claims at most one step.
- **Next step:** when a step completes, the next step of that run is queued as a new `pending` row (`src/jobs/stationStepComplete.js`), so it goes to the back of the location's FIFO.
- **Session expiry:** `src/jobs/expireFactorySessions.js` (every minute) marks a session `expired` after **5 minutes** without a poll. On the next poll the factory gets a fresh session; the poll route says reconnecting after "a long task" is expected.
- **Run timeouts:** `src/jobs/reapStuckStations.js` (every 5 minutes) marks work records `timed_out` when **`pending` > 30 minutes** or **`running` > 240 minutes**, and cancels their queued steps.
- **One run per station (mostly):** cron runs (`src/jobs/runScheduledStation.js`) and the bin/intake watchers (`hasInFlightRun`) skip a station that already has a `pending` or `running` run. Manual runs (`al-orc stations run`, the API) do not check.

### Steps within a station

A station is usually two steps: `lib-factory:move_files` (conveyor) then the processing step. They are separate tasks, dispatched one after the other. Between them, the conveyor step's output sits in the station's `input/` bin.

## Evidence (seen, 2026-10-23, factory-alex-mac at `alexs-mbp-16`)

Line AR's AR2 step uploads files to Backblaze B2 with `rclone move`; one 5.9 GB folder takes ~30 minutes, the largest queued file (21 GB) ~1.6 hours.

| Work record | Station | Outcome |
|---|---|---|
| `toILk0y5JXdg` | AR0 (intake) | `timed_out`: pending 30 min behind an AR2 upload; 48 queued paths not ingested |
| `VwqtesPTn2eD` | VM2 | `timed_out`: pending 30 min, same window |
| `KRZCyrmIM7tL`, `mIhm5rZQhiiO`, `tM341SVNheLo`, `kDwzd8rVtpcf` | VM2, VM4, VM3, VM5 | `timed_out`: running > 240 min (earlier the same day; cause not investigated here) |

Also seen: `[Factory] Poll error: fetch failed` lines in the session log during the AR2 upload, and the org has 24,629 `timed_out` work records in total (not all from this location; not broken down here).

Stop-gap applied in factory-alex-mac: AR2 `batch_size: 1`, so a run moves one file and other stations get a turn between files. The longest wait is still one file's upload.

## Constraints Any Fix Must Keep

1. **D1: one active session per (org, location).** Workpiece bundles live on the session's own disk (`process.cwd()/temp/stations`). Adding processes at one location breaks step-to-step locality. Concurrency has to happen **inside** the one session, or across **distinct** locations.
2. **One task per station at a time.** Two tasks of the same station would read the same `input/` bin and process the same workpiece twice (`processWorkpiece` copies `input → doing` and does not lock). Today the serial loop guarantees this; cron and watchers mostly guarantee it at the run level, manual runs don't.
3. **Steps of one run stay in order.** Already true: the orchestrator queues step N+1 only after step N completes.
4. **Crash recovery stays correct.** `cleanupOrphanedDoing()` runs at boot and discards every station's `doing/` bin. With several tasks in flight, a restart interrupts all of them, and recovery is still "redo from `input/`".
5. **Event loop stays free.** In-process concurrency only helps steps that `await`. A step doing long synchronous CPU work (big `readFileSync` + parse, a synchronous directory walk, hashing) blocks every other task in the process.

## Options

### A. Keep the serial loop; tune stations (today)

Small batches for long steps (`batch_size: 1`), short steps everywhere else.

- **For:** no code change.
- **Against:** the wait is bounded by the longest single item. Polling and the heartbeat still stop; runs still time out after 30 minutes pending.

### B. Separate sessions per line, using distinct locations (works today)

Run a second session from the same repo (a second pm2 process) with its own `FACTORY_LOCATION` (e.g. `alexs-mbp-16-archive`), and move the line's `location` there.

- **For:** no library change. Both sessions share one filesystem (same repo, same `temp/`), so D1's locality problem doesn't arise as long as each line lives in one location.
- **Against:**
  - **`cleanupOrphanedDoing()` sweeps every station's `doing/` at boot**, including the other session's in-flight work. It would need scoping to the session's own stations (`resolveWatchedStations` already knows which stations belong to the location). The temp pruner has the same "all stations" scope.
  - Both sessions start their own bin and intake watchers over every watched station unless scoped.
  - More processes and locations to run and monitor; fairness inside each session is still serial.

### C. In-process concurrent execution (recommended direction)

One session runs several tasks at once:

1. **Decouple the poll from execution.** A dispatcher keeps polling every `POLL_INTERVAL_MS` while tasks run; each claimed task starts without awaiting the previous one.
2. **Slots.** A cap on concurrent tasks (`FACTORY_MAX_CONCURRENT_TASKS`, default `1` = today's behaviour). When all slots are full, the session must keep its heartbeat but must not claim. Today the poll always claims, so this needs either a heartbeat-only poll (e.g. `?claim=false`, or a capacity header) or a separate heartbeat endpoint on the orchestrator.
3. **Per-station exclusivity.** Never run two tasks of the same station at once. Two ways:
   - Orchestrator: the claim query skips steps whose station already has a `claimed` step at the location. Keeps FIFO otherwise; no task is held locally. Needs `station` on `step_queue` or a join to `work_records`.
   - Factory: hold a claimed task until its station is free. Simpler on the orchestrator side, but a held task counts against the 30-minute pending reaper and occupies a claim. The poll response would need the station id (`lib-factory:move_files` is shared across stations, so the slug isn't enough).
4. **Fairness.** With slots and per-station exclusivity, a long station uses one slot and everything else keeps moving. If several long stations exist, a cap per "lane" (e.g. a station flag `long_running: true` limited to N slots) could be added **when seen**, not now.
5. **Shutdown.** On SIGINT/SIGTERM, stop claiming and either wait for in-flight tasks (bounded) or exit and rely on orphan cleanup. `docs/architecture/graceful-shutdown.md` already claims "waits for current task" but `startFactory` calls `process.exit(0)` immediately; fix the doc or the code as part of this.
6. **Logs.** Interleaved output from several tasks. `--- wr:{id} start/done` markers exist; step logs carry a `[slug]` prefix. Probably enough; check in practice.

- **For:** fits D1 (one process, one filesystem). Default `1` keeps today's behaviour, so factories opt in. Most steps are I/O-bound, so a single event loop handles several at once.
- **Against:** needs orchestrator changes (heartbeat without claim; station-exclusive claim). A step with synchronous CPU work still blocks everyone, now including concurrent tasks. Any module-level mutable state in a factory's steps becomes shared across concurrent tasks; it needs an audit.

### D. A child process per task (extension of C)

Run each task in a forked Node process (or `worker_threads`), with the session as dispatcher.

- **For:** CPU-heavy or crashing steps can't stall or kill the session; a stuck task can be killed on timeout.
- **Against:** more machinery (IPC for `attachReport` etc. or re-auth per child, startup cost per task). Worth it only if C shows CPU-bound steps blocking the loop.

### E. Detached long work inside a station (pattern, no library change)

A step starts the long job in the background (e.g. a detached `rclone`), records it in the workpiece, and returns; a later run checks completion and finishes the workpiece.

- **For:** no platform change; the long job doesn't hold the session at all.
- **Against:** every long-running station has to reimplement start/poll/finish and crash recovery; the work record no longer covers the real work. A per-station workaround, not a platform answer.

## Questions To Answer By Trying (not on paper)

- How many steps across the factories do long synchronous CPU work? Measure event-loop delay (`perf_hooks.monitorEventLoopDelay`) per step in a real session before choosing between C and D.
- Does a factory step keep module-level mutable state that would break under concurrency? Grep and run two stations at once in a dev session.
- How often do manual runs overlap a cron or watcher run of the same station? Decides whether per-station exclusivity must live in the orchestrator.
- What caused the VM2 to VM5 runs that hit the 240-minute limit? It may be the same serial-loop effect, or something else.

## Implementation Phases (if C is chosen)

### Phase 1: Decide ❌
- [ ] Measure event-loop delay and step durations in factory-alex-mac and factory-alex for a day
- [ ] Choose C (with or without D) and record it as a decision (lib-factory `docs/decisions/`), referencing D1

### Phase 2: Orchestrator ❌
- [ ] Heartbeat without claiming (poll parameter or separate endpoint) so a busy session never expires
- [ ] Station-exclusive claim (skip steps whose station has a `claimed` step at the location)
- [ ] Return the station id with each task

### Phase 3: lib-factory ❌
- [ ] Dispatcher: poll loop independent of execution, `FACTORY_MAX_CONCURRENT_TASKS` slots (default 1)
- [ ] Heartbeat while all slots are busy
- [ ] Shutdown: stop claiming; decide wait-vs-exit; align `graceful-shutdown.md` with the code
- [ ] Tests: two stations run concurrently; same station never overlaps; slot cap respected
- [ ] CHANGELOG and docs (`polling-loop.md`, `start-factory.md`, `environment-variables.md`)

### Phase 4: Roll out ❌
- [ ] factory-alex-mac: audit steps for module-level state and synchronous CPU work; set slots to 3; watch for a week
- [ ] Remove AR2's `batch_size: 1` stop-gap if no longer needed
- [ ] Other factories one at a time

## Related Files

- `src/factory.js`: session loop, `pollForTask`, `executeTask`, shutdown
- `src/bin-watcher.js`, `src/intake-watcher.js`, `src/utils/bin-watch-trigger.js`: watchers and `hasInFlightRun`
- `src/utils/workpiece-station.js`: `processWorkpiece`, `cleanupOrphanedDoing`
- `docs/architecture/polling-loop.md`, `docs/architecture/graceful-shutdown.md`
- Orchestrator: `src/app/api/factory/poll/route.js`, `src/jobs/stationStepComplete.js`, `src/jobs/expireFactorySessions.js`, `src/jobs/reapStuckStations.js`, `src/jobs/runScheduledStation.js`, `docs/decisions/0001-one-active-worker-session-per-location.md`
- Evidence: factory-alex-mac `docs/wip/b2-archive-line.md` ("Seen Problems")
