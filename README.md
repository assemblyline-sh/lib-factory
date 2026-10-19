# @assemblyline/lib-factory

The runtime for [Assembly Line](https://assemblyline.sh) factories. A factory repo depends on
it to run a factory session: poll the orchestrator for steps, run them, and report back. It
also provides the `defineStep()` API, station bins and workpieces, the bin and intake
watchers, and the conveyor step.

## Install

```bash
npm install github:assemblyline-sh/lib-factory#v0.1.0
```

## Env Vars

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ORCHESTRATOR_API_KEY` | Yes | — | Orchestrator API key (also identifies the org) |
| `ORCHESTRATOR_API_SECRET` | Yes | — | Orchestrator API secret |
| `FACTORY_LOCATION` | Yes | — | Where this factory session runs (sent as `X-Location`). The orchestrator dispatches only steps of lines whose `location` matches; at most one session per org and location |
| `ORCHESTRATOR_URL` | No | `http://localhost:3000` | Orchestrator server URL, e.g. `https://orchestrator.assemblyline.sh` |
| `POLL_INTERVAL_MS` | No | `2000` | Polling frequency (ms) |
| `NODE_ENV` | No | — | When set to `development`, dev-mode behaviors apply (e.g. `clearTemp` becomes a no-op) |

Path conventions are relative to `process.cwd()` (the factory repo root):

- Station bins: `temp/stations/{station}/{bin}/`
- Per-work-record scratch: `temp/work_records/{work_record_id}/`

## Exports

### Factory Session

| Function | Description |
|---|---|
| `startFactory({ getHandler, callerUrl })` | Start a factory session: the poll, run, report loop |
| `validateEnv()` | Validate required env vars at startup |
| `defineStep({ slug, name, inputSchema, outputSchema, execute })` | Define a step handler with Zod validation |
| `isStepDefinition(value)` | Type guard for `defineStep` output |
| `getStepHandler(definition)` | Extract the executable handler from a step definition |
| `createHandler(definition)` | Wrap a step definition into a handler function |

### Step Discovery

| Function | Description |
|---|---|
| `discoverSteps(dir)` | Auto-discover step modules in a directory |
| `createGetHandler(definitions)` | Build a `getHandler` from a definitions map |

### Station Triggering

Start alongside `startFactory()`. Each watcher triggers a `watch_enabled` station (from the
factory's local `.orchestrator/` files) when it has work and no run in flight.

| Function | Description |
|---|---|
| `startBinWatcher()` | Every 10 s: trigger conveyor stations whose `input` or upstream `source_bin` holds a workpiece. Also starts the intake watcher, and warns at boot about stations nothing triggers |
| `startIntakeWatcher()` | Every 10 s: trigger line-heads whose step 0 `watch_path` (an inbox folder or file) is non-empty. Started by `startBinWatcher()`; call it directly only if you don't use the bin-watcher |

### Orchestrator Integration

| Function | Description |
|---|---|
| `attachDocument(work_record_id, title, content, step_slug)` | Attach a supporting markdown document |
| `attachReport(work_record_id, content)` | Attach the final summary report |
| `attachFile(work_record_id, title, buffer, filename, step_slug)` | Attach a binary file (Excel, PDF, etc.) |
| `attachWorkpieces(work_record_id, workpieces)` | Report each workpiece's outcome (`done` or `failed`) |
| `clearTemp(work_record_id)` | Clear temp files for a work record (no-op in dev mode) |

### Template Rendering

| Function | Description |
|---|---|
| `renderTemplate(template_name, data)` | Render an EJS template: the factory's `src/templates/` first, then lib-factory's |
| `renderLocal(import.meta.url, relative_path, data)` | Render an EJS template co-located with a step |
| `initTemplates(callerUrl)` | Initialize the template loader (called by `startFactory`) |

### Config + Paths

| Function | Description |
|---|---|
| `resolveConfig(config, step_outputs)` | Resolve `{{env.VAR}}` and `{{step_slug.field}}` in a step config |
| `bin(station, ...segments)` | Resolve a station bin path (auto-creates) |
| `workRecordDir(work_record_id)` | Per-work-record scratch directory (auto-creates) |
| `workRecordFile(work_record_id, ...segments)` | Per-work-record file path (auto-creates parents) |

### File + Step Helpers

| Function | Description |
|---|---|
| `moveWorkpieces({ source_dir, target_dir, batch_size })` | Move workpieces (folders with a `pointer.json`) between bins |
| `listWorkpieces(bin_dir)` / `isWorkpieceDir(dir)` | The workpiece test shared by the conveyor and the bin-watcher |
| `processWorkpiece({ station, workpiece_id, work_record_id, body })` | 5-bin doing-bin contract helper for workpiece-mode steps |
| `cleanupOrphanedDoing()` | Clean up workpieces stranded in `doing/` |
| `logEvent(wp, station, work_record_id, event)` | Append a `{ts, station, wr, event}` line to `{wp}/log.jsonl` |
| `pooled(items, concurrency, fn)` | Run an async function over items with bounded concurrency |
| `stripFrontmatter(markdown)` | Strip YAML frontmatter |
| `countWords(text)` | Word count helper |

### Bundled Steps

| Slug | Export | Description |
|---|---|---|
| `lib-factory:move_files` | `moveFilesStep` | Conveyor: move workpieces between bins (supports a `moves` array) |

## Usage

```javascript
import 'dotenv/config';
import { startFactory, startBinWatcher, createGetHandler, discoverSteps } from '@assemblyline/lib-factory';

const definitions = await discoverSteps(new URL('./steps', import.meta.url));
startFactory({ getHandler: createGetHandler(definitions), callerUrl: import.meta.url });
startBinWatcher();
```

```javascript
import { defineStep, attachDocument } from '@assemblyline/lib-factory';
import { z } from 'zod';

export default defineStep({
  slug: 'EX1_fetch_data',
  name: 'Fetch data',
  inputSchema: z.object({ account_id: z.string() }),
  outputSchema: z.object({ row_count: z.number() }),
  async execute(config, { work_record, step }) {
    const data = await fetchSomething(config.account_id);
    await attachDocument(work_record.id, 'Raw data', JSON.stringify(data, null, 2), step.slug);
    return { row_count: data.length };
  },
});
```

## License

MIT
