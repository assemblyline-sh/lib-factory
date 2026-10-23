# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.36.1] - 2026-10-24

### Fixed
- Shutdown waits at most 500 ms for a poll in flight (was 3 s). pm2 sends `SIGKILL` 1.6 s
  after `SIGINT` by default, so a longer wait could stop the disconnect from leaving, and the
  orchestrator would not release the tasks still running.

## [0.36.0] - 2026-10-24

The version follows 0.2.2: the tags v0.3.0 to v0.35.0 on this repo are left over from
lib-worker, so this release takes the next free number.

### Changed
- A factory session runs tasks of different steps side by side. It starts each claimed task
  without waiting for it and keeps polling, so a long step (a multi-GB upload) no longer
  holds up every other station. A step still never runs two tasks at once: each poll sends
  the running slugs as `X-Exclude-Steps`. Requires the Orchestrator that reads that header
  (deployed 2026-10-24); an older one would hand out a second task of a running step.
- Shutdown waits for a poll in flight before disconnecting, and the session also disconnects
  when the orchestrator closes it, so the orchestrator puts the tasks still running back to
  `pending`.
- Error lines name the work record and step (`[Factory] wr:{id} [{slug}] error: ...`), and
  report errors name the task, since tasks now interleave in the log.

## [0.2.2] - 2026-10-19

### Fixed
- `ORCHESTRATOR_URL` defaults to `https://orchestrator.assemblyline.sh`, the same default as
  al-orc and factory-template's `.env.example` (was `http://localhost:3000`). Set it to
  `http://localhost:3000` to use a local Orchestrator.
- README: `attachFile(work_record_id, title, filepath, step_slug)` takes a path on disk, not a
  buffer and filename.

### Changed
- `CLAUDE.md` and the `bump-dependents` command no longer name local paths; dependents bump to
  the npm version. Test fixtures use example URLs.

## [0.2.1] - 2026-10-19

### Changed
- Published to npm as `@assemblyline/lib-factory`; the package ships `bin/`, `src/` and the
  docs only (`files` in package.json).
- The repo is public. Notes, docs and tests use generic names.

## [0.2.0] - 2026-10-19

### Added
- The `factory` command (`bin/factory.js`): `factory steps list`, `factory steps run <slug>`
  (`--station`, `--scenario`, `--empty`, or an arrow-key picker) and
  `factory stations update-step-metadata`. It replaces `al-factory`'s commands of the same
  names, and runs steps with the same copy of lib-factory the steps import.
- `runStepLocally()` and `isLocalRun()`: the local run and the `local-` id rule that makes
  attach calls skip the Orchestrator, in one file (`src/local-run.js`).
- A local run can run the shared `lib-factory:move_files` step, so a conveyor station's
  step 0 runs locally too.
- `dotenv` dependency, for the `factory` command's `.env` loading.

### Changed
- `watched-stations.js` reads `.orchestrator/` through the new shared readers in
  `src/utils/orchestrator-files.js`.

## [0.1.0] - 2026-10-19

First release as `@assemblyline/lib-factory`, forked from `@fob/lib-worker` 0.35.0. Entries
below 0.1.0 are the history of `@fob/lib-worker`.

### Changed
- **BREAKING:** package renamed to `@assemblyline/lib-factory`; installs from
  `github:assemblyline-sh/lib-factory`.
- **BREAKING:** `startWorker()` is `startFactory()`. The running process is a factory
  session; logs are prefixed `[Factory]`.
- **BREAKING:** `WORKER_LOCATION` is `FACTORY_LOCATION`.
- **BREAKING:** speaks the Assembly Line orchestrator protocol: endpoints `/api/factory/*`
  (poll, complete, failed, disconnect, attach-*), headers `X-Factory-User-Agent` and
  `X-Factory-Session`, and `?station=` on work-record queries. `X-Location` is unchanged.
- **BREAKING:** the conveyor step slug is `lib-factory:move_files`.
- `validateEnv()` takes no options; `startFactory()` takes `{ getHandler, callerUrl }`.
- Docs, JSDoc examples and the template helper notes use generic examples instead of
  finance ones.

### Added
- `LICENSE` (MIT).

### Fixed
- JSDoc types in `discover-steps.js` and `workpiece-station.js` no longer fail a factory's
  `npm run typecheck`.

### Removed
- **BREAKING:** the legacy item API (`findItemByExternalId`, `createItem`,
  `findOrCreateItem`) and `runProcess()`. Their orchestrator routes no longer exist; trigger
  runs through `/api/v1/stations/:id/run`.
- Passthrough and statements env vars, and docs for code that is no longer in this package.

## [0.35.0] - 2026-10-03

### Added
- **Intake watch for line-heads.** A `watch_enabled` station whose step 0 is not a conveyor can now declare a `watch_path` in its step 0 config — the inbox folder or file it drains. `startIntakeWatcher()` (`src/intake-watcher.js`) polls each one every 10 s and triggers a run when it is non-empty (a file larger than 0 bytes, or a folder with any entry not starting with `.`) and no run is in flight. A relative `watch_path` resolves against the worker root; a missing one logs a warning at boot and counts as no work. `startBinWatcher()` starts it, so workers need no code change. Polls rather than using `fs.watch`, which is unreliable on macOS and in iCloud folders.
- The startup warning now also flags a line-head that feeds a conveyor but has neither `schedule_enabled` nor `watch_enabled` — the gap that can leave a line's first station with no trigger. A standalone station that feeds nothing is still not flagged.

### Changed
- A `watch_enabled` station with neither a `move_files` step 0 nor a step 0 `watch_path` is still a boot error; the message now names both options.

## [0.34.0] - 2026-10-03

### Changed
- **BREAKING:** bins move workpieces only. A workpiece is a non-dot folder holding a `pointer.json`; the `move_files` conveyor and the bin-watcher now use the same test (`listWorkpieces()` in `files.js`), so the watcher only triggers on what the conveyor will move. Loose files, sub-bins (e.g. `output/extract/`) and folders without a pointer are left where they are.
- **BREAKING:** `move_files` loses its files mode. `mode`, `pattern` and `recursive` are gone and the config is strict: `mode: "files"`, `pattern` or `recursive` fails the step with a validation error rather than silently moving nothing. `mode: "directories"` is still accepted, and ignored, so existing station files keep working unchanged.
- **BREAKING:** removed `lib-worker:split_bundles` (`splitBundlesStep`). It split loose PDFs sitting in an `input` bin — the same loose-file model as files mode — and no station used it. A worker's `src/index.js` that imports `splitBundlesStep` must drop the import and its registration.
- **BREAKING:** `moveFiles()` is replaced by `moveWorkpieces({ source_dir, target_dir, batch_size })`; `listWorkpieces()` and `isWorkpieceDir()` are exported alongside it.

### Migration
- A line whose conveyors used files mode must move to workpiece folders before upgrading.
- Every workpiece must carry a `pointer.json`, or the conveyor won't move it and the watcher won't see it. A line that marks its workpieces with `bundle.json` only needs a `pointer.json` added before upgrading.
- Optional: drop `"mode": "directories"` from station files the next time they're pushed.

## [0.33.0] - 2026-09-05

### Changed
- **BREAKING:** the bin-watcher decides which stations are "at this location" through the station's **line**, not a per-station `location`. `watched-stations.js` loads `.orchestrator/lines/*.json` (`{ code, name, location }`, pulled by `fob-orc lines pull`), keeps the lines whose `location` equals `WORKER_LOCATION`, and then keeps only stations whose `line` code is in that set. Station files no longer carry `location` at all — the orchestrator dropped the column ([D3](../../apps/orchestrator.finopsbricks.com/docs/decisions/0003-lines-are-a-core-object.md)). A worker repo that has not been re-pulled has no `.orchestrator/lines/` and **fails at boot** with a message naming the command to run, rather than silently watching nothing. A station file with no `line` is likewise a boot error.

### Migration
- In every worker repo: bump to this version, then `fob-orc lines pull --all && fob-orc stations pull --all`, commit, restart.

## [0.32.0] - 2026-08-12

### Added

- Workers exit on a location conflict. The orchestrator now enforces one active session per `(org, location)` and refuses a second worker with `409 LOCATION_IN_USE`; the worker prints the orchestrator's message — which names the incumbent session and host — once, then exits 1. Retrying cannot succeed, so the previous behaviour would have logged the same refusal every poll interval forever. The exit code is deliberately non-zero: exiting 0 would have a process manager restart into an immediate re-refusal, spinning quietly, whereas a failing restart loop is a visible signal that the worker needs stopping or relocating.

## [0.31.0] - 2026-08-12

### Added

- Workers now announce a graceful shutdown. `SIGTERM`/`SIGINT` POST to `/api/worker/disconnect` before exiting, so the orchestrator ends the session immediately instead of leaving it `active` until the 5-minute expiry sweep notices. This matters because a location may only have one active worker session: without it, a restarted worker is refused by its own stale session for up to five minutes. Best-effort by design — 3s timeout, all errors swallowed, so shutdown can never hang on an unreachable orchestrator.
- Workers honour an orchestrator-closed session. When a poll response carries `session_closed`, the worker stops polling and exits 0 — a process manager may then restart it, and it registers a fresh session. This is what lets the orchestrator free a location or remotely stop a worker. Requires an orchestrator new enough to send the field; older ones simply never do, so behaviour is unchanged against them.

## [0.30.1] - 2026-07-15

### Fixed

- `processWorkpiece()` now clears any existing `doing/` and `done/` directory before writing into it, matching the overwrite behavior `output/` and `failed/` already had. Previously a manual retry of a workpiece that had already completed once threw `ENOTEMPTY` renaming `input/` → `done/` (since a prior successful run's `done/{workpiece_id}` still existed), misfiling the retry as a station failure. A stranded `doing/` copy from a crash mid-run is now also blown away on the next attempt instead of merging via `cpSync`.

## [0.28.0] - 2026-06-18

### Added

- `attachWorkpieces(work_record_id, workpieces)` — voluntary worker → orchestrator call that records the per-workpiece outcome map on a WR. The map is `workpiece_id → "done" | "failed"`; the orchestrator derives `done_count` / `failed_count` and stores all three. Modelled on `attachReport` / `attachDocument`. Steps build the map from their own knowledge (a `seeded` list for line-heads, a `results` array for body stations) and call this once before `attachReport`. Empty `{}` is valid and represents a no-op run.

### Removed

- **Breaking:** `workpieceOutcomes(station, pending)`. Bin-walking helper from 0.27.0 — replaced by `attachWorkpieces` plus per-step explicit map building. The previous design (nesting `workpieces` inside step `output` and letting the orchestrator lift it) is gone; steps now report directly to a dedicated endpoint.

## [0.27.0] - 2026-06-18

### Added

- ~~`workpieceOutcomes(station, pending)`~~ — **superseded in 0.28.0.** Bin-walking helper that classified workpieces into a `Record<string, "done"|"failed">` by walking `done/` and `failed/`. Replaced by per-step explicit map building plus `attachWorkpieces`.

## [0.26.0] - 2026-06-18

### Added

- `wr` (work record id) is now recorded on every `log.jsonl` event emitted by `processWorkpiece` and `logEvent`. This lets a workpiece's log answer "which WR processed this transition?" — previously only timestamp and station were recorded, so the WR side of the linkage required matching by inference. Older log lines without `wr` remain valid; readers should treat missing `wr` as unknown.

### Changed

- **Breaking:** `logEvent(wp, station, event)` → `logEvent(wp, station, work_record_id, event)`. All callers must thread the WR id through.
- **Breaking:** `processWorkpiece({ station, workpiece_id, body })` → `processWorkpiece({ station, workpiece_id, work_record_id, body })`. The new arg is passed to the three auto-emitted lifecycle events. Steps read `work_record.id` from their step context and forward it.

## [0.25.0] - 2026-06-06

### Added

- `processWorkpiece` failure capture now writes a structured `error.json` alongside `error.txt` in the failed bin. Any enumerable own properties attached to the thrown Error (e.g. `status`, `statusText`, `headers`, `body`, `cause`) are serialized — making upstream-API failures self-diagnosable. Full body lives in `error.json`; `error.txt` carries a 500-char-truncated preview.

### Changed

- `error.txt` format: now `failed_at`, `Name: message`, one line per extra field, then stack. Previously duplicated the message line above the stack — V8's `err.stack` already begins with `Name: message`, so the duplicate is now stripped.

## [0.24.0] - 2026-06-06

### Added

- **Workpiece Mode** — 5-bin doing-bin contract for stations that process items with per-item bodies. New helpers:
  - `processWorkpiece({ station, workpiece_id, body })` — wraps the body in input → doing → mutate → output/done on success, or input → failed with log overlay on error
  - `logEvent(wp, station, event)` — append one event to `{wp}/log.jsonl`; auto-emitted as `station_started` / `station_complete` / `station_failed` by `processWorkpiece`
  - `cleanupOrphanedDoing()` — discards stranded `doing/{wp}/` directories from a prior crashed run; called automatically by `startWorker` at boot
- General step-authoring helpers, hoisted from worker repos:
  - `pooled(items, concurrency, fn)` — bounded-concurrency async pool, preserves input order
  - `stripFrontmatter(md)` — strip leading YAML frontmatter block
  - `countWords(text)` — whitespace-split word count

### Changed

- `bin()` JSDoc lists `'doing'` as an allowed bin type alongside the prior four
- `startWorker` now runs `cleanupOrphanedDoing()` at boot before the polling loop (no-op when no `doing/` bins exist)

## [0.23.0] - 2026-05-31

### Added
- `recursive` option for `moveFiles()` and `lib-worker:move_files` step — walks subdirectories and flattens files into target using `__` separator (e.g., `vendor-a/file.pdf` → `vendor-a__file.pdf`)

### Fixed
- `bin()` now accepts arbitrary depth segments — `source_bin: "CD2/output/PO"` was silently dropping the third segment and reading from `CD2/output/` instead
- `move_files` step passes all bin path segments through to `bin()` via rest destructuring

## [0.22.0] - 2026-05-29

### Added
- Multi-source moves in `lib-worker:move_files` step — `source_bin` now accepts an array of bins to merge files from multiple sources into one target
- Test suite for `move_files` step (file mode, directory mode, multi-source mode)

### Fixed
- `move_files` step defaults to `attachDocument` instead of `attachReport`
- `split_bundles` step defaults to `attachDocument` instead of `attachReport`

## [0.21.1] - 2026-05-29

### Fixed
- `moveFiles` directory mode now merges into existing target directories instead of failing with `ENOTEMPTY` — enables two `move_files` steps to move same-named bundles to the same target

### Added
- Test suite for `moveFiles` (file and directory modes)

## [0.21.0] - 2026-05-29

### Changed
- **BREAKING**: Bin layout migrated from flat `temp/work_area/{station}_{type}/` to nested `temp/stations/{station}/{type}/`
- **BREAKING**: `move_files` config format changed from `"HI1_output"` to `"HI1/output"` — all process definitions must update `source_bin`/`target_bin` values
- `parseBin()` now splits on `/` instead of last underscore
- Internal constant renamed from `WORK_AREA` to `STATIONS`

## [0.20.0] - 2026-05-23

### Removed
- Statements API client extracted to `@fob/lib-worker-statements`
- Passthrough API client removed (no consumers)
- Email utilities extracted to `@fob/lib-worker-email` — `sendEmail`, `sendEmailToMultiple`

## [0.19.0] - 2026-05-23

### Removed
- AI/LLM utilities extracted to `@fob/lib-worker-ai` — `createModel`, `generateStructured`, `extractDocument`, `renderPrompt`, `extractJsonFromText`, `generateText`, `Output`, `tool`
- Removed `ai` and `@openrouter/ai-sdk-provider` dependencies

## [0.18.0] - 2026-05-22

### Added
- `split_bundles` shared step (`lib-worker:split_bundles`) — splits a PDF bundle into individual page PDFs using qpdf. Requires `qpdf` binary on the host.

## [0.17.0] - 2026-05-22

### Changed
- `move_files` step slug renamed to `lib-worker:move_files` — library steps now namespace their slugs with `lib-name:` prefix for clarity in process definitions

## [0.14.0] - 2026-05-21

### Added
- Worker User-Agent and session support — workers now send structured `User-Agent` and `X-Session-ID` headers to orchestrator during polling
- `buildUserAgent()` utility for constructing standardized user agent strings
- Export `moveFiles` from file utilities

### Changed
- Updated architecture documentation for location-based routing

## [0.13.0] - 2026-05-21

### Added
- AI/LLM structured generation utilities (`generateStructured`, `extractDocument`, `createModel`, `renderPrompt`, `extractJsonFromText`) — consolidates duplicated code from worker repos
- New dependencies: `ai`, `@openrouter/ai-sdk-provider`

### Changed
- Renamed `STEP_PREFIX` env var to `WORKER_LOCATION`
- Renamed `X-Step-Prefix` poll header to `X-Location`
- Config resolver uses first-dot parsing instead of slash-based prefix matching

## [0.12.0] - 2026-05-20

### Removed
- `WORKER_TYPE` env var and `X-Worker-Type` poll header — worker type is no longer sent to orchestrator

## [0.6.1] - 2026-03-07

### Fixed
- `attachDocument` and `attachReport` skip remote POST for local CLI runs (`fob steps run`) to avoid noisy 404 errors

## [0.6.0] - 2026-03-02

### Added
- Rules API endpoints in txn client: `createRule`, `getRule`, `getRules`, `updateRule`, `runRule`

### Changed
- Migrated worker authentication from shared secret to per-org API keys
- Replaced `WORKER_SECRET` env var with `ORCHESTRATOR_API_KEY` and `ORCHESTRATOR_API_SECRET`
- Replaced `WORKER_ORG` env var with `STEP_PREFIX`
- Auth headers changed from `Authorization: Bearer` to `api-key`/`api-secret` headers
- Worker poll header changed from `X-Worker-Org` to `X-Step-Prefix`

## [0.5.0] - 2026-03-02

### Added
- `resolveConfig()` utility for resolving template variables in step configs — supports `{{env.VAR_NAME}}` for environment variables and `{{step_slug.field.path}}` for previous step outputs
- Exported `resolveConfig` from main package index

### Changed
- `createHandler()` now automatically resolves config templates before input validation using `resolveConfig`

## [0.4.1] - 2026-02-24

### Added
- Export `createHandler` for test usage

## [0.4.0] - 2026-02-24

### Added
- `defineStep()` factory function for declarative step definitions with Zod schema validation
- `isStepDefinition()` helper to check if a value is a step definition
- `createHandler()` function that wraps step definitions with automatic input/output validation
- `getStepHandler()` function for registry lookup with step definition enforcement
- New dependencies: `zod` and `zod-to-json-schema` for schema validation

### Fixed
- Temp filename handling in `attachDocument` - sanitized step slugs to avoid subdirectory issues and simplified filenames to just use the title

### Changed
- Updated architecture documentation for task structure, handler resolution, and document attachment

## [0.3.0] - 2026-02-16

### Changed
- Renamed `step_type` to `slug` in task handling (breaking change for task interface)
- Updated `getHandler` to receive `slug` instead of `step_type`

### Added
- JSDoc `@typedef` for `Task` object in main exports

## [0.2.0] - 2026-02-07

### Added
- Worker polling loop (`startWorker`) for process engine workers
- Orchestrator integration (`attachDocument`, `attachReport`, `clearTemp`)
- Txn app API client with auto-pagination support
- Passthrough API client for external service calls
- EJS-based template rendering system with two-layer templates
- Comprehensive architecture documentation (18 docs)

### Changed
- Refined template renderer implementation

### Removed
- Balance calculator utilities (moved to worker repos)
- Report generator utilities (consolidated elsewhere)
- Sample report templates (no longer needed in shared lib)
