// @ts-check

/**
 * `factory steps list` and `factory steps run <slug>`.
 */

import path from 'node:path';
import { discoverFactorySteps, runStepLocally } from '../local-run.js';
import { findStation, findStationsWithStep, listScenarios, loadScenario } from '../utils/orchestrator-files.js';
import { pick } from './picker.js';
import { CliError } from './errors.js';

/**
 * @param {string} root - Factory repo root
 */
export async function listSteps(root) {
  const steps = await discoverFactorySteps(root);
  const rows = Object.keys(steps).map((slug) => {
    const parts = (steps[slug]._file || '(lib-factory)').split('/');
    const file = parts.pop() || '-';
    return { slug, folder: parts.join('/') || '-', file };
  });

  console.log(`Source: src/steps/`);
  console.log('');
  if (rows.length === 0) {
    console.log('No steps found');
    return;
  }

  rows.sort((a, b) => a.folder.localeCompare(b.folder) || a.file.localeCompare(b.file));
  const slug_width = Math.max(4, ...rows.map((r) => r.slug.length));
  const folder_width = Math.max(6, ...rows.map((r) => r.folder.length));
  console.log(`${'SLUG'.padEnd(slug_width)}  ${'FOLDER'.padEnd(folder_width)}  FILE`);
  console.log('-'.repeat(slug_width + folder_width + 30));
  for (const { slug, folder, file } of rows) {
    console.log(`${slug.padEnd(slug_width)}  ${folder.padEnd(folder_width)}  ${file}`);
  }
  console.log('');
  console.log(`Total: ${rows.length} steps`);
}

/**
 * @param {any} station
 * @returns {string}
 */
function stationLabel(station) {
  return `${station.name} (${station.short_code || station.id})`;
}

/**
 * The step's config from a station file. Throws when the station is missing or doesn't run
 * the step.
 *
 * @param {string} root
 * @param {string} code - Station short_code or id
 * @param {string} slug
 * @returns {{ config: object, source: string }}
 */
function configFromStation(root, code, slug) {
  const found = findStation(root, code);
  if (!found) {
    throw new CliError(`Station not found locally: ${code}\nRun "al-orc stations pull ${code}" first`);
  }
  const { station } = found;
  const step = station.steps?.find((/** @type {any} */ s) => s.slug === slug);
  if (!step) {
    const available = station.steps?.map((/** @type {any} */ s) => s.slug).join(', ') || '(none)';
    throw new CliError(`Step "${slug}" not found in station "${code}"\nAvailable steps: ${available}`);
  }
  return { config: step.config || {}, source: `station: ${stationLabel(station)}` };
}

/**
 * @param {string} root
 * @param {string} slug
 * @param {string} name
 * @returns {{ config: object, source: string }}
 */
function configFromScenario(root, slug, name) {
  const config = loadScenario(root, slug, name);
  if (!config) {
    const available = listScenarios(root, slug).join(', ') || '(none)';
    throw new CliError(`Scenario not found: ${name}\nAvailable scenarios: ${available}`);
  }
  return { config, source: `scenario: ${name}` };
}

/**
 * Ask which config to run with: each station that runs the step, each saved scenario, or none.
 *
 * @param {string} root
 * @param {string} slug
 * @returns {Promise<{ config: object, source: string } | null>}
 */
async function pickConfig(root, slug) {
  /** @type {import('./picker.js').PickerOption[]} */
  const options = [
    ...findStationsWithStep(root, slug).map((station) => ({
      label: `Station: ${stationLabel(station)}`,
      value: station.short_code || station.id,
      type: 'station',
    })),
    ...listScenarios(root, slug).map((name) => ({ label: `Scenario: ${name}`, value: name, type: 'scenario' })),
    { label: 'No config (empty)', value: 'empty', type: 'empty' },
  ];
  const chosen = await pick(`Select config for ${slug}:`, options);
  if (!chosen) return null;
  if (chosen.type === 'station') return configFromStation(root, chosen.value, slug);
  if (chosen.type === 'scenario') return configFromScenario(root, slug, chosen.value);
  return { config: {}, source: 'empty' };
}

/**
 * @param {string} root - Factory repo root
 * @param {string} slug
 * @param {{ station?: string, scenario?: string, empty?: boolean }} flags
 */
export async function runStep(root, slug, flags) {
  const steps = await discoverFactorySteps(root);
  if (!steps[slug]) {
    throw new CliError(`Unknown step: ${slug}\nRun "factory steps list" to see available steps`);
  }

  let chosen;
  if (flags.empty) chosen = { config: {}, source: 'empty (--empty)' };
  else if (flags.station) chosen = configFromStation(root, flags.station, slug);
  else if (flags.scenario) chosen = configFromScenario(root, slug, flags.scenario);
  else chosen = await pickConfig(root, slug);

  if (!chosen) {
    console.log('Cancelled');
    return;
  }

  console.log(`Step: ${slug}`);
  console.log(`Config: ${chosen.source}`);
  console.log('');
  console.log('-'.repeat(60));
  console.log('Running step...');
  console.log('-'.repeat(60));

  const { output, output_path, task } = await runStepLocally({ slug, config: chosen.config, root, steps });
  const chained = Object.keys(task.work_record.step_outputs);

  console.log('');
  console.log('-'.repeat(60));
  console.log('Output:');
  console.log('-'.repeat(60));
  console.log(JSON.stringify(output ?? null, null, 2));
  console.log('');
  if (chained.length > 0) console.log(`Step outputs it could read: ${chained.join(', ')}`);
  console.log(`Output saved: ${path.relative(root, output_path)}`);
  console.log('Step completed successfully');
}
