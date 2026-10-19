# CLAUDE.md

> **Assembly Line fork** of FinOpsBricks' lib-worker (remote `finopsbricks`). History starts
> fresh at 0.1.0; the history before it is in the private repo
> `assemblyline-sh/lib-factory-archive` (remote `archive`). Fixes from lib-worker carry over
> with `git cherry-pick` (unrelated histories apply as patches).
> Workspace rules and vocabulary: `CLAUDE.md` in the workspace folder above this repo (`../..`).

Guidance for Claude Code when working with this package.

## Overview

`@assemblyline/lib-factory` is the runtime every factory repo depends on. It provides:

- **Factory session** — `startFactory()` polls the orchestrator for steps, runs them, reports
  results, and holds one session per org and location
- **Step framework** — `defineStep()` with Zod schema validation, auto-discovery, config
  resolution
- **Orchestrator integration** — attaching documents, files, reports and workpiece outcomes
  to work records
- **Template rendering** — two-layer EJS templates (the factory overrides lib defaults)
- **Bins and workpieces** — station bin paths, the 5-bin doing-bin contract, workpiece
  movement, `log.jsonl`
- **Watchers** — bin watcher (conveyors) and intake watcher (line-heads)
- **Shared steps** — `move_files` (namespaced as `lib-factory:*`)

### Related Repositories

Part of **Assembly Line** (GitHub org `assemblyline-sh`; in the workspace, paths are relative to `../..`):

- **`apps/orchestrator.assemblyline.sh`** — dispatches steps to factory sessions and keeps
  work records.
- **`factories/*`** — factory repos that consume this package; `factory-template` is the
  starter.
- **`cli/al-control`** — the control room CLI: bins, workpieces and processes of any factory,
  on any host. Running steps is this package's `factory` command (`bin/factory.js`);
  `cli/al-factory`, which did both, is deprecated.
- **`cli/al-orc`** — the orchestrator's CLI: lines, stations, runs, work records.

Optional station libraries (AI, Google, email) live outside this repo; they don't import this
one, so factories use them unchanged.

## Package Structure

```
bin/
└── factory.js                # `factory` command (steps list/run, stations update-step-metadata)
src/
├── index.js                  # Main exports
├── cli/                      # The `factory` command: index (args), steps, stations, picker
├── factory.js                # startFactory — factory session loop
├── validate-env.js           # Fail-fast env validation
├── orchestrator.js           # attachDocument, attachFile, attachReport, attachWorkpieces, clearTemp
├── define-step.js            # defineStep, createHandler, getStepHandler
├── discover-steps.js         # discoverSteps, createGetHandler
├── local-run.js              # runStepLocally, isLocalRun — `local-` ids skip the orchestrator
├── renderLocal.js            # Co-located EJS template rendering
├── factoryPaths.js           # bin(), workRecordDir(), workRecordFile()
├── files.js                  # moveWorkpieces(), listWorkpieces(), isWorkpieceDir()
├── bin-watcher.js            # startBinWatcher — triggers watch_enabled conveyors
├── intake-watcher.js         # startIntakeWatcher — triggers watch_enabled line-heads
├── steps/
│   └── move_files.js         # lib-factory:move_files shared step
└── utils/
    ├── config-resolver.js    # {{env.VAR}} and {{step_slug.field}} resolution
    ├── template-renderer.js  # Two-layer EJS rendering
    ├── orchestrator-files.js # Readers for .orchestrator/ stations, lines, scenarios
    ├── watched-stations.js   # Stations this session's location watches
    ├── bin-watch-trigger.js  # In-flight check + station run trigger
    ├── workpiece-station.js  # processWorkpiece, cleanupOrphanedDoing
    ├── workpiece-log.js      # logEvent → {wp}/log.jsonl
    └── build-user-agent.js   # Factory session user-agent string
```

## Usage

Factory repos consume this package:

```javascript
import 'dotenv/config';
import { startFactory, startBinWatcher, discoverSteps, createGetHandler } from '@assemblyline/lib-factory';

const steps = await discoverSteps(new URL('./steps', import.meta.url));
startFactory({ getHandler: createGetHandler(steps), callerUrl: import.meta.url });
startBinWatcher();
```

## Environment Variables

This package uses `process.env` directly. No config abstraction. Required vars are
validated at startup by `validateEnv()`. See `.env.example`.

## Releasing

Releases are git tags (`v0.1.0`) and npm versions of `@assemblyline/lib-factory`. After
`/release` updates the version, tag, push and `npm publish`, then run `/bump-dependents` to
move every factory repo in the workspace to the new version.

## Key Principles

1. **No config object** - Use `process.env` directly throughout
2. **Fail fast** - Missing required env vars cause immediate exit
3. **Defaults in .env.example** - Not in code

## Documentation

- [assemblyline.sh/docs](https://assemblyline.sh/docs) — concepts, quickstart, using agents
- `docs/` in this repo — architecture notes, decisions and work in progress
