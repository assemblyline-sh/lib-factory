/**
 * Intake watch: triggers a line-head station when the inbox it drains has
 * something in it, instead of waiting for its cron. Each watched line-head
 * declares one `watch_path` in its step 0 config — a folder (dropped files)
 * or a file (a list of URLs) — and a line-head leaves that path empty after a
 * successful run, so "non-empty" is the whole test.
 *
 * Separate from the bin-watcher (bin-watcher.js), which serves conveyor
 * stations; the two share only the in-flight check and the trigger call.
 * Polls rather than using fs.watch, which is unreliable on macOS and in
 * iCloud-synced folders.
 */

import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { resolveIntakeWatchedStations } from './utils/watched-stations.js';
import { hasInFlightRun, triggerStationRun } from './utils/bin-watch-trigger.js';

const DEFAULT_INTERVAL_MS = 10_000;

/**
 * True when the watched path holds work: a file larger than 0 bytes, or a
 * folder with any entry not starting with `.`. A missing path holds none.
 *
 * @param {string} abs_path
 * @returns {Promise<boolean>}
 */
export async function pathHasWork(abs_path) {
  let stats;
  try {
    stats = await stat(abs_path);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }

  if (stats.isFile()) return stats.size > 0;
  if (stats.isDirectory()) {
    const names = await readdir(abs_path);
    return names.some(name => !name.startsWith('.'));
  }
  return false;
}

/**
 * Trigger each watched line-head whose inbox has work and that has no run
 * already in flight. Errors on one station never block the rest — logged
 * and skipped.
 *
 * @param {import('./utils/watched-stations.js').IntakeWatchedStation[]} watched
 */
export async function checkAndTriggerIntake(watched) {
  for (const { station, station_id, watch_path } of watched) {
    try {
      if (!(await pathHasWork(watch_path))) continue;
      if (await hasInFlightRun(station_id)) continue;

      const { work_record_id } = await triggerStationRun(station_id);
      console.log(`[intake-watcher] triggered ${station} (work_record_id=${work_record_id})`);
    } catch (err) {
      console.error(`[intake-watcher] ${station}: ${err.message}`);
    }
  }
}

/**
 * Start the intake-watch loop: resolves the watch-list once, warns about any
 * `watch_path` that doesn't exist yet (a typo, or a folder that will appear
 * later — it counts as "no work" until it does), then re-checks on an interval.
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs]
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startIntakeWatcher(opts = {}) {
  const interval_ms = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const watched = await resolveIntakeWatchedStations();

  for (const { station, watch_path } of watched) {
    if (!existsSync(watch_path)) {
      console.warn(`[intake-watcher] ${station}: watch_path ${watch_path} does not exist — nothing to watch until it does`);
    }
  }

  const timer = setInterval(() => {
    checkAndTriggerIntake(watched).catch(err => {
      console.error(`[intake-watcher] tick failed: ${err.message}`);
    });
  }, interval_ms);
  timer.unref();

  return { stop: () => clearInterval(timer) };
}
