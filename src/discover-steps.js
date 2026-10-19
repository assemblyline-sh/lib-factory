// @ts-check

import { readdirSync } from 'fs';
import { join, relative } from 'path';
import { pathToFileURL } from 'url';
import { isStepDefinition, createHandler } from './define-step.js';

/**
 * Recursively find all .js files in a directory.
 * Skips index.js files.
 *
 * @param {string} dir - Absolute path to scan
 * @returns {string[]}
 */
function findStepFiles(dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full_path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findStepFiles(full_path));
    } else if (entry.name.endsWith('.js') && entry.name !== 'index.js') {
      files.push(full_path);
    }
  }

  return files;
}

/**
 * Scan a directory tree for step definition files and build a registry.
 *
 * Each .js file (except index.js) is dynamically imported. Files that default-export
 * a defineStep() result are registered by their slug. Files that don't are skipped
 * with a warning. Disabled steps (enabled: false) are skipped silently.
 * Duplicate slugs throw at startup.
 *
 * @param {string} steps_dir - Absolute path to the steps/ directory
 * @returns {Promise<Object<string, import('./define-step.js').StepDefinition<any, any> & { _file?: string }>>} slug → step definition
 */
export async function discoverSteps(steps_dir) {
  const step_files = findStepFiles(steps_dir);
  /** @type {Object<string, import('./define-step.js').StepDefinition<any, any> & { _file?: string }>} */
  const steps = {};

  for (const file_path of step_files) {
    let module;
    try {
      module = await import(pathToFileURL(file_path).href);
    } catch (err) {
      console.warn(`[Factory] Failed to import ${file_path}: ${err.message}`);
      continue;
    }

    const step = module.default;

    if (!isStepDefinition(step)) {
      console.warn(`[Factory] Skipping ${file_path} — not a step definition`);
      continue;
    }

    if (step.enabled === false) {
      console.log(`[Factory] Skipping disabled step: ${step.slug}`);
      continue;
    }

    if (steps[step.slug]) {
      throw new Error(
        `Duplicate slug "${step.slug}" found in ${file_path}`
      );
    }

    steps[step.slug] = Object.assign(step, { _file: relative(steps_dir, file_path) });
  }

  console.log(`[Factory] Discovered ${Object.keys(steps).length} steps from ${step_files.length} files`);
  return steps;
}

/**
 * Create a getHandler function from discovered steps.
 * Drop-in replacement for the manually-maintained getHandler in factory repos.
 *
 * @param {Object<string, import('./define-step.js').StepDefinition<any, any>>} steps - From discoverSteps()
 * @returns {(step_type: string) => Function|null}
 */
export function createGetHandler(steps) {
  return (step_type) => {
    const step = steps[step_type];
    if (!step) return null;
    return createHandler(step);
  };
}
