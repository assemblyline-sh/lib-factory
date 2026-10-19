// @ts-check

/**
 * Readers for a factory repo's `.orchestrator/` folder: the station, line and scenario
 * files that `al-orc lines/stations pull` keep in sync with the orchestrator.
 *
 *   .orchestrator/stations/<CODE>__<snake_name>.json   one station, its `line` names its line
 *   .orchestrator/lines/<CODE>.json                    one line, with its `location`
 *   .orchestrator/scenarios/<slug>/<name>.json         a saved config for one step
 *
 * In a scenario folder name, every `/` in the step slug becomes `__`.
 */

import fs from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} root - Factory repo root
 * @returns {string}
 */
export function stationsDir(root) {
  return path.join(root, '.orchestrator', 'stations');
}

/**
 * @param {string} root - Factory repo root
 * @returns {string}
 */
export function linesDir(root) {
  return path.join(root, '.orchestrator', 'lines');
}

/**
 * @param {string} root - Factory repo root
 * @param {string} slug - Step slug
 * @returns {string}
 */
export function scenariosDir(root, slug) {
  return path.join(root, '.orchestrator', 'scenarios', slug.replace(/\//g, '__'));
}

/**
 * Read every `.json` file in a directory. Throws ENOENT when the directory is missing.
 *
 * @param {string} dir
 * @returns {Promise<{ file: string, config: any }[]>}
 */
export async function readJsonDir(dir) {
  const files = await readdir(dir);
  const result = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readFile(path.join(dir, file), 'utf8');
    result.push({ file, config: JSON.parse(raw) });
  }
  return result;
}

/**
 * Every station file, sorted by filename. Empty when the folder is missing.
 *
 * @param {string} root - Factory repo root
 * @returns {{ filepath: string, station: any }[]}
 */
export function listStationFiles(root) {
  const dir = stationsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const filepath = path.join(dir, f);
      return { filepath, station: JSON.parse(fs.readFileSync(filepath, 'utf8')) };
    });
}

/**
 * Find a station by short_code or id: first by filename prefix (`<CODE>__`), then by the
 * `id` or `short_code` inside the file.
 *
 * @param {string} root - Factory repo root
 * @param {string} identifier - Station short_code or id
 * @returns {{ filepath: string, station: any } | null}
 */
export function findStation(root, identifier) {
  const all = listStationFiles(root);
  const by_name = all.find(({ filepath }) => path.basename(filepath).startsWith(`${identifier}__`));
  if (by_name) return by_name;
  return all.find(({ station }) => station.id === identifier || station.short_code === identifier) ?? null;
}

/**
 * Stations that run a given step.
 *
 * @param {string} root - Factory repo root
 * @param {string} slug - Step slug
 * @returns {any[]}
 */
export function findStationsWithStep(root, slug) {
  return listStationFiles(root)
    .map(({ station }) => station)
    .filter((station) => station.steps?.some((/** @type {any} */ s) => s.slug === slug));
}

/**
 * Names of the saved scenarios for a step (filenames without `.json`), sorted.
 *
 * @param {string} root - Factory repo root
 * @param {string} slug - Step slug
 * @returns {string[]}
 */
export function listScenarios(root, slug) {
  const dir = scenariosDir(root, slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/**
 * A saved scenario config, or null when it doesn't exist.
 *
 * @param {string} root - Factory repo root
 * @param {string} slug - Step slug
 * @param {string} name - Scenario name, without `.json`
 * @returns {object | null}
 */
export function loadScenario(root, slug, name) {
  const filepath = path.join(scenariosDir(root, slug), `${name}.json`);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}
