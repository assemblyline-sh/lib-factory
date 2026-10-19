# Local step runner: run a step from inside lib-factory

## Status: IN PROGRESS (~75%)

Move "run a step locally" (`al-factory steps run` and `steps list`) out of the global
al-factory CLI and into lib-factory, as a command lib-factory ships (a `bin`). Every factory
already depends on lib-factory, so the runner arrives with `npm install` and always matches
the version of the library it drives. If this works well, al-factory has nothing left that
needs a factory's code, and can be retired once al-control takes its floor commands. The
wider study is in `apps/assemblyline.sh/docs/wip/cli-architecture.md` (D1) in the workspace.

---

## Problem Statement

`al-factory steps run <slug>` is installed globally, but everything it touches lives in the
factory's copy of lib-factory:

- **Loader workaround.** It imports
  `<cwd>/node_modules/@assemblyline/lib-factory/src/index.js` by a hard-coded path
  (`cli/al-factory/src/utils/lib-factory-loader.js`). Without it, the CLI's copy of the
  library and the factory's copy were two module instances, and `initTemplates` set up one
  while the step read the other (fixed in fob-worker `35bbd6b`). The path breaks if
  `src/index.js` moves.
- **Internals used from outside.** It calls `discoverSteps`, `createHandler`,
  `initTemplates` and `resolveConfig`. A change to any of them breaks a different repo.
- **Unwritten contract.** It builds a fake task whose ids start with `local-`;
  `src/orchestrator.js:17` (`isLocalRun`) skips every orchestrator call for those ids. The
  two halves of that rule live in two repos.
- **Untested end to end.** al-factory's tests mock lib-factory, so no test runs a real step.
- **Version skew.** One global CLI serves every factory, whatever lib-factory tag each one
  pins.

## Proposed Solution

lib-factory gets a `bin`. Its code imports the library with relative paths, so it is the
same module instance the steps import. No loader, no skew.

```
# today (global CLI)
al-factory steps list
al-factory steps run EX1_01_check --scenario two-invoices

# proposed (inside a factory repo)
npx factory steps list
npx factory steps run EX1_01_check --scenario two-invoices
npm run step -- EX1_01_check --scenario two-invoices     # template script
```

Behaviour is carried over unchanged, so existing scenarios and habits keep working:

- Config source: `--station <CODE>`, `--scenario <name>`
  (`.orchestrator/scenarios/<slug>/<name>.json`), `--empty`, or an arrow-key picker when
  none is given.
- `step_outputs` loaded from `temp/*.json`; the result written to `temp/<slug>.json`.
- `.env` loaded from the factory root, as `npm run start` does.
- Templates initialised from the factory's `src/index.js` (two-layer templates).
- Ids start with `local-`, so attach and report calls write to `temp/` and skip the
  orchestrator.

The task builder moves next to `isLocalRun` (for example `src/local-run.js`), exported as
`runStepLocally({ slug, config, stepsDir, tempDir })`, so the contract lives in one file and
the CLI is a thin shell over it.

### Decisions

| | Question | Recommendation |
|---|---|---|
| R1 | Command name | Bin `factory` (`npx factory …`), plus a `step` script in factory-template. Not `al-factory`: a global al-factory and a local one with the same name would shadow each other during the transition |
| R2 | Command shape | Keep `steps list` and `steps run`, same flags. Agents and CLAUDE.md files already know them |
| R3 | Dependencies | Arguments with `node:util` `parseArgs` (no yargs). Keep the hand-rolled picker (no `@inquirer/prompts`). Add `dotenv` (factories already use it; same parsing as `npm run start`). `engines` stays `>=18` |
| R4 | `stations update-step-metadata` | Move it too. It needs step discovery, which only exists here, and it is the last al-factory command that needs a factory's code. Use the same `.orchestrator/stations` reader as `watched-stations.js` |
| R5 | Shell completion | Drop. It was the only reason the CLI had to silence lib-factory's stdout. `npx factory steps list` covers it |
| R6 | al-factory's `steps` commands during the transition | They keep working; they print a one-line notice pointing to `npx factory steps run`. Removed when al-factory is retired |

## Implementation Phases

### Phase 1: Runner core in lib-factory ✅
- [x] `src/local-run.js`: `runStepLocally()` builds the task (ids `local-…`, `org_id: 'local'`,
      `step_outputs` from `temp/`), resolves config, calls the handler, writes
      `temp/<slug>.json` (config resolved once, by the handler; al-factory resolved it twice). `isLocalRun` moves here and `orchestrator.js` imports it
- [x] Station and scenario readers (`loadStation`, `getStepConfigFromStation`,
      `findStationsWithStep`, `listScenarios`, `loadScenario`), sharing the
      `.orchestrator/` reading in `watched-stations.js` rather than copying al-factory's
      `station-files.js` (`src/utils/orchestrator-files.js`; `watched-stations.js` now uses its
      `readJsonDir`)
- [x] Export `runStepLocally` from `src/index.js`; JSDoc and `// @ts-check`

### Phase 2: The `factory` command ✅
- [x] `bin/factory.js` + `"bin": { "factory": "bin/factory.js" }` in package.json; code in
      `src/cli/`
- [x] `steps list`, `steps run <slug>` (`--station`, `--scenario`/`-s`, `--empty`/`-e`),
      `stations update-step-metadata`, `--help`, `--version`
- [x] Port the picker (`src/cli/picker.js`, no dependencies); it refuses without a terminal
      and points to the flags
- [x] Load `.env` from the factory root before discovering steps; `initTemplates` from the
      factory's `src/index.js`
- [x] Clear errors when run outside a factory (no `src/steps/`), for an unknown slug, and for a
      missing station or scenario (hint: `al-orc stations pull`)
- [x] Also new: `lib-factory:move_files` is in the registry, so a conveyor station's step 0
      runs locally too (factories register it by hand in `src/index.js`; al-factory couldn't
      run it)
- [x] Tried on a copy of factory-template: EX0 intake → `lib-factory:move_files` → EX1 gives
      2 done and 1 failed, as the template README says; `steps list` on factory-alex finds 37
      steps

### Phase 3: Tests ✅
- [x] Fixture factory under `test/fixtures/factory/` with two real `defineStep` steps, two
      station files and two scenarios. `test/helpers/fixture-factory.js` copies it to a temp
      dir and links `node_modules/@assemblyline/lib-factory` back here, like a real factory
- [x] `test/local-run.test.js`: a real step through `runStepLocally`; output in `temp/`; the
      second step reads the first one's output and `.env`; document, report and workpieces
      written under `temp/work_records/local-wr-…/` with `fetch` never called
- [x] `test/cli.test.js` spawns `bin/factory.js` in the fixture: `steps list`,
      `steps run --scenario/--station/--empty`, chaining, unknown step/station/scenario, no
      terminal, a throwing step exits 1 without saving, `update-step-metadata`, `--version`,
      outside a factory
- [x] `test/utils/orchestrator-files.test.js`: station lookup by prefix, id and short_code;
      scenarios
- [x] al-factory's jest tests for these commands mock lib-factory and the file helpers; they
      are replaced by the real-step tests above rather than ported. 107 tests pass (32 new)

### Phase 4: Release and try it on real factories 🔄
- [x] CHANGELOG, README section "Run a step locally", `docs/architecture/local-step-runner.md`;
      update the `al-factory` mentions in `CLAUDE.md` and `src/orchestrator.js`
- [x] Version 0.2.0, tagged `v0.2.0`
- [x] factory-alex (scratch copy, lib-factory linked): `EM1_01_classify_email --station EM1`
      gives the same output through `al-factory steps run` (0.1.0) and `factory steps run`;
      `steps list` finds the same 37 steps plus `lib-factory:move_files`
- [x] factory-actual, factory-alex-mac, factory-chisel, factory-template: `steps list` loads
      every step (5, 12, 18, 3)
- [ ] Push the tag; bump every factory to `v0.2.0` (needs the tag on GitHub, since factories
      install from it); factory-template gets `"step": "factory steps run"`

### Phase 5: Point everything at it ❌
- [ ] Factory CLAUDE.md and README files (`steps list`/`steps run` lines only; the floor commands
      wait for al-control)
- [ ] Skill `migrate-worker-to-factory`: `SKILL.md` and `scripts/apply-renames.sh` use
      `npx factory steps list`
- [ ] al-factory: notice on `steps list/run` and `stations update-step-metadata` (R6)
- [ ] assemblyline.sh docs (`quickstart.mdx`, `ai-agents.mdx`, `index.mdx`) and the
      orchestrator's docs (`index.mdx`, `guide/concepts.mdx`). The site still says
      `fob-worker`, so this lands with the site's own rename

### Phase 6: Retire al-factory ❌
Only once al-control exists and has taken `lines`, `stations status`, `workpieces` and `procs`
(cli-architecture.md, Phase 4 there).
- [ ] Remove the `steps` and `update-step-metadata` commands from al-factory, then archive the repo
      and deprecate the npm package

## Related Files

- `cli/al-factory/src/cli/steps/run.js`, `list.js` - the runner today (169 + 42 lines)
- `cli/al-factory/src/utils/lib-factory-loader.js` - the workaround this removes
- `cli/al-factory/src/utils/steps-loader.js`, `output.js`, `picker.js`, `config.js`
- `cli/al-factory/src/utils/station-files.js` - station and scenario readers (only part is live)
- `cli/al-factory/src/cli/stations/update-step-metadata.js`
- `src/orchestrator.js` - `isLocalRun` and the local writes for `attach*`
- `src/discover-steps.js`, `src/define-step.js`, `src/utils/config-resolver.js`,
  `src/utils/template-renderer.js` - what the runner calls
- `src/utils/watched-stations.js` - the existing `.orchestrator/` reader
