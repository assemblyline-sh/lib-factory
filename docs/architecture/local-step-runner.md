# Local Step Runner

`factory steps run <slug>` runs one step on the developer's machine, outside a factory
session. It ships with lib-factory (`bin/factory.js`, code in `src/cli/` and
`src/local-run.js`), so a factory runs steps with the lib-factory version it pins.

## Why it lives here

The step imports `@assemblyline/lib-factory`. The runner calls `discoverSteps`,
`createHandler` and `initTemplates`, and relies on `isLocalRun`. If the runner used a
different copy of the library from the steps, `initTemplates` would set up one copy while
the step read the other. A global CLI had to reach into the factory's `node_modules` by
path to avoid that. A `bin` inside the package imports the library by relative path, so
it is always the same copy.

## The local task

`buildLocalTask()` gives the step a task shaped like the Orchestrator's:

```javascript
{
  step_queue_id: 'local-1792402757306',
  step: { slug, config },
  work_record: { id: 'local-wr-1792402757306', step_outputs },
  org_id: 'local',
}
```

`isLocalRun(work_record_id)` is true for `local-` ids. The attach calls in
`orchestrator.js` still write their file under `temp/work_records/<id>/`, then return
without calling the Orchestrator. Both halves of the rule are in `src/local-run.js`.

## Config and chaining

- The config comes from a station file (`--station`), a scenario
  (`.orchestrator/scenarios/<slug>/<name>.json`), nothing (`--empty`), or a picker.
- The handler resolves `{{env.X}}` and `{{slug.field}}` once, like a factory session does.
- `step_outputs` are every `temp/*.json` (except `*.config.json`); the output is written to
  `temp/<slug>.json`. Running steps in order chains them.
- `.env` is loaded from the factory root before the steps are imported.
- The registry is the factory's `src/steps` plus `lib-factory:move_files`.

## Related Notes

- [task-structure.md](/docs/architecture/task-structure.md)
- [temp-file-storage.md](/docs/architecture/temp-file-storage.md)
- [two-layer-templates.md](/docs/architecture/two-layer-templates.md)
