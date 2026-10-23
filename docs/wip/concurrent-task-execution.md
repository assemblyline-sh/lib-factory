# Concurrent Task Execution in a Factory Session

## Status: IN PROGRESS (~70%)

A factory session runs one task at a time. While one long step runs (a multi-GB upload, a long transcription), every other station on that location waits, the session stops polling, and the orchestrator times out runs queued behind it. This WIP records how the session works today, the evidence that it now hurts, and the chosen fix. The session runs a task of each step slug at the same time. It tells the orchestrator which slugs are busy, so no step ever runs twice at once. The WIP also lists what reading the code turned up.

Standards read: `principles/solve-problems-you-have-seen.md`, `principles/try-it-to-decide.md`, `principles/abstraction-earns-its-keep.md`, `git-workflow/wip-files.md`. Related decision: orchestrator `docs/decisions/0001-one-active-worker-session-per-location.md` (D1).

---

## How It Works Today

### The session loop (`src/factory.js`)

```js
while (true) {
  const task = await pollForTask();             // GET /api/factory/poll
  if (task) await executeTask(task, getHandler); // runs the step to the end
  await sleep(poll_interval);                     // POLL_INTERVAL_MS, default 2000
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
| `KRZCyrmIM7tL`, `mIhm5rZQhiiO`, `tM341SVNheLo`, `kDwzd8rVtpcf` | VM2, VM4, VM3, VM5 | `timed_out`: running > 240 min. Cause below (lost reports, not the serial loop) |

Also seen: `[Factory] Poll error: fetch failed` lines in the session log during the AR2 upload, and the org has 24,629 `timed_out` work records in total (not all from this location; not broken down here).

### Why runs hang for 240 minutes (investigated 2026-10-24)

All four were claimed by session `UacnLsx-cTKs`, which ran without a restart from 10-22 07:37 to 10-23 22:22 (PID 32825, 13,599 tasks). So a restart is not the cause. Two causes, both seen:

- **Lost completion report (VM2, VM3, VM5).** The factory log shows each conveyor step `done`, but the orchestrator has no `run.step.completed`. `reportComplete` logs a network error and gives up. The step stays `claimed`, so the run stays `running`. The error log has 23 `Complete report error: fetch failed` and 1 `Complete report failed: 522` (Cloudflare connection timed out).
- **Lost poll response (VM4).** The orchestrator logged `run.step.claimed` for `VM4_01_clean_whisper` at 17:53:26, but the factory log never shows that task starting. The claim committed and the response never reached the factory, which saw `Poll error: fetch failed` (352 such lines in the error log).

In both cases nothing ever puts the `claimed` step back. The run waits for the 240-minute reaper, and until then `hasInFlightRun` stops cron and the watchers from starting that station. Session `UacnLsx-cTKs` stranded 10 steps this way (8 `move_files`, 1 VM4, 1 VM5). A restart strands claims by the same mechanism, but none was seen here.

Stop-gap applied in factory-alex-mac: AR2 `batch_size: 1`, so a run moves one file and other stations get a turn between files. The longest wait is still one file's upload.

## Constraints Any Fix Must Keep

1. **D1: one active session per (org, location).** Workpiece bundles live on the session's own disk (`process.cwd()/temp/stations`). Concurrency has to happen **inside** the one session.
2. **Never two tasks of the same step at once.** Two runs of one station's processing step would read the same `input/` bin and process the same workpiece twice (`processWorkpiece` copies `input → doing` and does not lock). An `rclone move` step run twice would upload the same file twice. Today the serial loop guarantees this. Cron and watchers also skip a station with a run in flight (`hasInFlightRun`), but manual runs don't.
3. **Steps of one run stay in order.** Already true: the orchestrator queues step N+1 only after step N completes (`stationStepComplete.js`).
4. **Crash recovery stays correct.** `cleanupOrphanedDoing()` discards every `doing/` bin at boot. The next run redoes the work from `input/`.

## Design: Each Step Runs on Its Own, One at a Time

This works like a real assembly line: each station works on its item as fast as it can, whatever is happening at the other stations. A step never runs alongside another task of the same step.

**Factory (`src/factory.js`).** The session keeps the tasks it is running, keyed by step slug. Each poll sends those slugs as exclusions. A claimed task starts without the loop waiting for it, and its slug comes off the list when it finishes.

```js
const running = new Map();                           // step slug → step_queue_id
while (true) {
  const task = await pollForTask([...running.keys()]); // X-Exclude-Steps: slug,slug
  if (task) {
    running.set(task.step.slug, task.step_queue_id);   // before the next poll
    executeTask(task, getHandler).finally(() => running.delete(task.step.slug));
  }
  await sleep(poll_interval);
}
```

**Orchestrator (`src/app/api/factory/poll/route.js`).** The claim query gets one more condition, added only when the list is non-empty: `AND step_slug NOT IN (:excluded_steps)`. Otherwise it still takes the oldest pending step at the location.

Why this is enough:

- **The key is the step slug, which every poll response already carries** (`task.step.slug`). No station id or schema change is needed.
- **Every bin is safe.** A station's `doing/` bin is touched only by that station's processing step, and in factory-alex-mac each processing slug belongs to exactly one station (`AR2_01_move_to_b2`, `VM3_01_transcribe_whisper`, ...). Promotions between bins are `renameSync`, so a conveyor never sees half a workpiece.
- **No slot cap.** The number of tasks in flight is bounded by the number of distinct step slugs.
- **No heartbeat endpoint.** The loop keeps polling while tasks run, so a busy session never goes quiet and never expires. The old option C needed a poll that doesn't claim only because full slots stopped the polling.
- **The factory decides what to exclude, not the orchestrator.** The orchestrator could work it out from its own `claimed` rows, but a lost `/complete` call (`reportComplete` swallows network errors, and `Poll error: fetch failed` was seen) would then block that slug for the whole session. The factory's list matches what is actually running.
- **Manual runs are covered as well.** A manual run of a busy station now waits for the running one instead of overlapping it. Today it overlaps.

## Found in the Code (2026-10-24)

I read through the orchestrator (poll, complete, failed, `stationStepComplete`, reaper, session expiry) and lib-factory plus factory-alex-mac to find problems this change causes or makes worse.

**Caused or made worse by this change: fix as part of it**

1. **A restart strands every task in flight.** No job resets `claimed` rows (only the cancel route and the 240-minute reaper touch them). After `pm2 restart`, which is also how changes are deployed, each run that was in flight stays `running` until the reaper times it out at 240 minutes. Until then `hasInFlightRun` stops cron and the watchers from starting that station. This already happens today with one task, and it may explain the VM2 to VM5 `running > 240 min` rows above. With concurrency it hits every busy station at once. **Fix (orchestrator):** `/api/factory/disconnect`, which the factory already calls on SIGINT/SIGTERM, also puts that session's `claimed` steps back to `pending` (`claimed_at` and `factory_session` cleared, `retry_count` unchanged). The restarted session claims them again, and because the orphan cleanup at boot emptied `doing/`, the step redoes the work from `input/`. The factory needs no change. A crash (no disconnect) is not covered: those claims still wait for the 240-minute reaper. Releasing them when a session expires is unsafe today, because a session expires after 5 quiet minutes even while its step is still running (a sync block, a network outage). Revisit when a crash is seen.
2. **An old orchestrator ignores the exclusions.** A new lib-factory polling an orchestrator without this change would claim the same step twice. **Order:** deploy the orchestrator first, then release lib-factory. There is one hosted orchestrator, so the order is enough.
3. **An empty exclusion list breaks the SQL.** `NOT IN ()` is invalid, so the clause must be added only when the list has slugs.
4. **Error logs don't say which task failed.** `executeTask` logs `[Factory] error: <message>` with no work record id or slug. Once tasks interleave, a failure can't be traced to its task. Add `wr:{id} [slug]` to that line. Nothing parses the `--- wr:` markers (I checked al-control, control-room and lib-factory), so interleaved output breaks no tool. Interleaving does break the readable `start … done` blocks that factory-alex's `docs/wip/worker-log-cleanup-target.md` takes as its target layout, so update that WIP when this ships.

**Accepted for now, revisit when seen**

5. **`lib-factory:move_files` is one slug for 11 stations.** All conveyors at the location run one after another. They are renames that take seconds, so this is acceptable. If it ever matters, key the exclusion by station and slug (the poll response would then need the station).
6. **Synchronous calls block the whole process.** There are `execFileSync` calls (`gh`, `git` in the BL and RR utils, `stat` in `icloud-guard.js`) and `readdirSync` walks (AR0, AR1, backlog utils). They delay other tasks but don't break them. Measure event-loop delay before doing anything about it.
7. **Competition for the machine.** Whisper (VM3), yt-dlp (Y1, M1) and rclone (AR2) can now run at the same time and compete for CPU, memory and bandwidth. This hasn't been seen yet. If it is, group heavy steps under a shared key.
8. **Module-level state is benign.** In factory-alex-mac it is only `_version_cache` (the yt-dlp version) in `youtube-audio.js` and `youtube-video.js`, and constant `Set`s. In lib-factory it is the session flags and the templates dir, set once at startup.

**Already true today, not caused by this change (proposals, out of scope)**

- `/api/factory/complete` doesn't check whether the step was cancelled or the run timed out. A late completion still marks it `completed` and queues the next step.
- `/api/factory/failed` resets a retryable step to `pending` with no backoff, so it can be claimed again on the next poll.
- **Lost reports hang runs for 240 minutes** (seen, see "Why runs hang" above). A lost `/complete` or a lost poll response leaves the step `claimed` forever. Decided 2026-10-24 to keep this out of this change. A later fix could have the factory send its running `step_queue_id`s on each poll, so the orchestrator releases any `claimed` step at the location that isn't in the list, plus retry `reportComplete`/`reportFailed` against idempotent routes.
- **An admin closing a session** (D2) makes the factory exit on its next poll without calling `/disconnect`, so its claims are not released.
- **A poll in flight during shutdown** can claim a step after `/disconnect` released the session's claims (the poll passed the session check before the disconnect committed). That step stays `claimed`. The window is one poll, and the serial loop has it today.
- **No index on `step_queue.factory_session`.** The release on `/disconnect` scans the table, once per disconnect. Add a partial index (`WHERE status = 'claimed'`) if disconnects get slow.

## Considered and Set Aside

- **A. Small batches (`batch_size: 1`).** This is the stop-gap in place. The wait is still as long as the longest single item.
- **B. A second session with its own location.** No library change, but `cleanupOrphanedDoing()` and the watchers would need scoping per session, and there would be more processes to run.
- **C as first written: N slots and poll whenever a slot is free.** This needs a cap, a poll that doesn't claim (for the heartbeat while slots are full) and a separate per-station exclusivity mechanism. The per-step exclusion design gives the same result without any of the three.
- **D. A child process per task.** Only worth it if synchronous CPU work (item 6) turns out to block the loop.
- **E. Detached long jobs inside a station.** Every long station would have to reimplement start, poll and finish.

## Implementation Phases

### Phase 1: Orchestrator ✅
- [x] Poll reads `X-Exclude-Steps` (comma-separated slugs) and adds `AND step_slug NOT IN (...)` when non-empty
- [x] `/api/factory/disconnect` resets the session's `claimed` steps to `pending` and logs `run.step.released` (item 1)
- [x] Tests: `tests/api/factory/poll-exclude-steps.test.js`, `disconnect.test.js`. Also run once against a throwaway Postgres loaded from `scripts/db/schema.sql`: exclusions (including `lib-factory:move_files`), quoting, release scoped to the session, the next session claiming the released step
- [x] Committed: orchestrator `30337788`
- [x] Deployed 2026-10-24 (CI 40027520035, Deploy Main 40028038311). Production check: a poll with `X-Exclude-Steps` at a location with no work returned 200 `{task: null}`, and `/disconnect` for an unknown session returned `released_steps: 0`. factory-alex-mac on lib-factory 0.2.0 kept claiming and completing tasks. The browser smoke check covered only the public pages, which all redirect to `/login` (no saved login session).
- [ ] Restart factory-alex-mac while a step runs; check `run.step.released` in its activity and that the step runs again (done in Phase 3, on the new lib-factory)

### Phase 2: lib-factory ✅
- [x] `running_tasks` map; `pollForTask(excluded_steps)` sends the header; `executeTask` runs without the loop waiting for it
- [x] Error lines carry `wr:{id} [slug]`, report errors carry the task id
- [x] Shutdown stops polling and waits for a poll in flight before disconnecting; the session also disconnects when the orchestrator closes it
- [x] Tests (`test/factory.test.js`, fake orchestrator over HTTP): two different slugs run at once; the same slug never overlaps; a failed step frees its slug; SIGINT disconnects after the last poll; a closed session disconnects. The two concurrency tests fail against the old loop
- [x] Docs: `polling-loop.md`, `graceful-shutdown.md` (no longer claims it waits for the current task), CHANGELOG
- [x] Release 0.36.0, git tag only, no npm (origin's tags v0.3.0 to v0.35.0 are left over from lib-worker, so 0.3.0 was taken). Factories on `^0.2.2` don't pick it up

### Phase 3: Roll out ❌
- [ ] factory-alex-mac: bump, deploy, and check that AR0 and the VM stations finish while an AR2 upload runs
- [ ] Watch for a week: event-loop delay (item 6) and machine load (item 7)
- [ ] Decide whether to remove AR2's `batch_size: 1`
- [ ] Other factories (`/bump-dependents`)

## Related Files

- `src/factory.js`: session loop, `pollForTask`, `executeTask`, shutdown
- `src/utils/workpiece-station.js`: `processWorkpiece`, `cleanupOrphanedDoing`
- `src/utils/bin-watch-trigger.js`: `hasInFlightRun`
- `docs/architecture/polling-loop.md`, `docs/architecture/graceful-shutdown.md`
- Orchestrator: `src/app/api/factory/poll/route.js`, `src/app/api/factory/complete/route.js`, `src/app/api/factory/failed/route.js`, `src/jobs/stationStepComplete.js`, `src/jobs/reapStuckStations.js`, `src/jobs/expireFactorySessions.js`, `docs/decisions/0001-one-active-worker-session-per-location.md`
- Evidence: factory-alex-mac `docs/wip/b2-archive-line.md` ("Seen Problems")
