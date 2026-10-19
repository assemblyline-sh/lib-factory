// @ts-check

/**
 * Run one step on this machine, outside a factory session.
 *
 * The step gets a task shaped like the orchestrator's, but every id starts with `local-`.
 * `isLocalRun()` recognises those ids, so `attachDocument`, `attachFile`, `attachReport`
 * and `attachWorkpieces` write to `temp/work_records/local-wr-…/` and never call the
 * orchestrator. Both halves of that rule live in this file.
 *
 * Outputs chain through `temp/`: each run writes `temp/<slug>.json`, and the next run
 * reads every `temp/*.json` as `work_record.step_outputs`, so a later step can use
 * `{{earlier_slug.field}}` in its config.
 *
 * The step itself runs for real: an API call or a write to another system happens.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverSteps } from './discover-steps.js';
import { createHandler } from './define-step.js';
import { initTemplates } from './utils/template-renderer.js';
import moveFilesStep from './steps/move_files.js';

const LOCAL_PREFIX = 'local-';

/**
 * Whether a work record id comes from a local run, so remote calls must be skipped.
 *
 * @param {string} work_record_id
 * @returns {boolean}
 */
export function isLocalRun(work_record_id) {
  return work_record_id.startsWith(LOCAL_PREFIX);
}

/**
 * `temp/` file name for a step's output. `/` in a slug becomes `__`.
 *
 * @param {string} slug
 * @returns {string}
 */
export function outputFilename(slug) {
  return slug.replace(/\//g, '__') + '.json';
}

/**
 * Every saved step output in `temp/`, keyed by slug. `*.config.json` files are skipped;
 * a file that isn't valid JSON is skipped with a warning.
 *
 * @param {string} temp_dir
 * @returns {Object<string, any>}
 */
export function loadStepOutputs(temp_dir) {
  if (!fs.existsSync(temp_dir)) return {};
  /** @type {Object<string, any>} */
  const outputs = {};
  for (const file of fs.readdirSync(temp_dir)) {
    if (!file.endsWith('.json') || file.endsWith('.config.json')) continue;
    const slug = file.slice(0, -'.json'.length).replace(/__/g, '/');
    try {
      outputs[slug] = JSON.parse(fs.readFileSync(path.join(temp_dir, file), 'utf8'));
    } catch {
      console.warn(`[Factory] Skipping ${file}: not valid JSON`);
    }
  }
  return outputs;
}

/**
 * A task shaped like the orchestrator's, with `local-` ids.
 *
 * @param {object} args
 * @param {string} args.slug
 * @param {object} args.config - Raw step config; the handler resolves its templates
 * @param {Object<string, any>} args.step_outputs
 * @param {number} [args.now]
 * @returns {import('./index.js').Task}
 */
export function buildLocalTask({ slug, config, step_outputs, now = Date.now() }) {
  return {
    step_queue_id: `${LOCAL_PREFIX}${now}`,
    step: { slug, config },
    work_record: { id: `${LOCAL_PREFIX}wr-${now}`, step_outputs },
    org_id: 'local',
  };
}

/**
 * The factory's steps, from `<root>/src/steps`, plus lib-factory's shared
 * `lib-factory:move_files` (which every factory registers in its `src/index.js`).
 *
 * @param {string} root - Factory repo root
 * @returns {Promise<Object<string, import('./define-step.js').StepDefinition<any, any> & { _file?: string }>>}
 */
export async function discoverFactorySteps(root) {
  const steps_dir = path.join(root, 'src', 'steps');
  if (!fs.existsSync(steps_dir)) {
    throw new Error(`No steps folder at ${steps_dir}. Run this from a factory repo's root.`);
  }
  const steps = await discoverSteps(steps_dir);
  return { ...steps, [moveFilesStep.slug]: moveFilesStep };
}

/**
 * @typedef {object} LocalRunResult
 * @property {any} output - What the step returned
 * @property {string} output_path - Where it was saved: `<root>/temp/<slug>.json`
 * @property {import('./index.js').Task} task - The task the step received
 */

/**
 * Run one step locally and save its output to `temp/`.
 *
 * @param {object} args
 * @param {string} args.slug - Step slug
 * @param {object} [args.config] - Raw step config (from a station, a scenario, or `{}`)
 * @param {string} [args.root] - Factory repo root; defaults to the current directory
 * @param {Object<string, any>} [args.steps] - Discovered steps; discovered from `<root>/src/steps` when omitted
 * @returns {Promise<LocalRunResult>}
 */
export async function runStepLocally({ slug, config = {}, root = process.cwd(), steps }) {
  const registry = steps ?? (await discoverFactorySteps(root));
  const step = registry[slug];
  if (!step) throw new Error(`Unknown step: ${slug}`);

  // Templates resolve from the factory's src/templates first, then lib-factory's.
  initTemplates(pathToFileURL(path.join(root, 'src', 'index.js')).href);

  const temp_dir = path.join(root, 'temp');
  fs.mkdirSync(temp_dir, { recursive: true });

  const task = buildLocalTask({ slug, config, step_outputs: loadStepOutputs(temp_dir) });
  const output = await createHandler(step)(task);

  const output_path = path.join(temp_dir, outputFilename(slug));
  fs.writeFileSync(output_path, JSON.stringify(output ?? null, null, 2));
  return { output, output_path, task };
}
