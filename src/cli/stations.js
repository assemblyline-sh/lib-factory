// @ts-check

/**
 * `factory stations update-step-metadata`: copy each step's `name` and `description` from
 * its `defineStep()` into every station file that runs it, so `al-orc stations push` sends
 * the current text. Station files are rewritten in place.
 */

import fs from 'node:fs';
import { discoverFactorySteps } from '../local-run.js';
import { listStationFiles } from '../utils/orchestrator-files.js';

/**
 * @param {string} root - Factory repo root
 */
export async function updateStepMetadata(root) {
  const steps = await discoverFactorySteps(root);
  /** @type {Object<string, { name: string, description: string }>} */
  const metadata = {};
  for (const [slug, step] of Object.entries(steps)) {
    if (step?.name) metadata[slug] = { name: step.name, description: step.description || '' };
  }
  console.log(`Loaded ${Object.keys(metadata).length} step definitions`);
  console.log('');

  const files = listStationFiles(root).filter(({ station }) => station.id);
  if (files.length === 0) {
    console.log('No local stations found');
    console.log('Run "al-orc stations pull --all" first');
    return;
  }

  let updated = 0;
  for (const { filepath, station } of files) {
    let changed = false;
    for (const step of station.steps ?? []) {
      const meta = metadata[step.slug];
      if (meta && (step.name !== meta.name || step.description !== meta.description)) {
        step.name = meta.name;
        step.description = meta.description;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(filepath, JSON.stringify(station, null, 2));
      console.log(`Updated: ${station.name} (${station.short_code || station.id})`);
      updated++;
    }
  }

  console.log('');
  console.log(`Updated ${updated} of ${files.length} stations`);
}
