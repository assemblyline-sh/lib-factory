/**
 * Resolves which stations a factory session should bin-watch trigger, by reading the
 * calling factory's own .orchestrator/ files directly (the same files
 * `al-orc lines/stations pull` keep in sync with the orchestrator).
 *
 * A line owns its location (orchestrator D3): `.orchestrator/lines/*.json`
 * carries `{ code, location }`, and every station file names its line by code.
 * A station is "at this location" when its line's location equals
 * `process.env.FACTORY_LOCATION`. A single factory repo may hold lines at several
 * locations, and a factory session only ever executes tasks for its own — so it
 * must not bin-watch-trigger stations meant for a different one.
 *
 * Eligibility to be watched is `watch_enabled === true` on the station itself —
 * a real orchestrator-side column (Stations.watch_enabled), not a hardcoded list.
 * Step 0 decides which watcher serves it: a `move_files` conveyor is
 * bin-watched (resolveWatchedStations), a line-head with a `watch_path` is
 * intake-watched (resolveIntakeWatchedStations).
 */

import path from 'node:path';
import { readJsonDir, linesDir, stationsDir } from './orchestrator-files.js';

/**
 * @typedef {object} WatchedStation
 * @property {string} station - Short_code, used for logging.
 * @property {string} station_id - The station's database id. `/api/v1/work-records?station=` does an
 *   exact match against this id — unlike `/api/v1/stations/:id/run`, it does NOT resolve short_codes —
 *   so the in-flight check and the trigger call must both use this, not `station`.
 * @property {string} source_station - Short_code of the upstream station whose bin to watch.
 * @property {string} source_bin - Bin path within source_station (e.g. 'output', or a nested bin
 *   like 'output/approved' for a human-approval-gated conveyor).
 */

/**
 * @typedef {object} IntakeWatchedStation
 * @property {string} station - Short_code, used for logging.
 * @property {string} station_id - The station's database id (see WatchedStation).
 * @property {string} watch_path - Absolute path of the inbox to watch: a folder or a file.
 */

/**
 * Codes of the lines served by this factory session's location.
 *
 * A missing `.orchestrator/lines/` is an error, not "no lines": every station
 * needs a line to be routable, so a repo without line files has not been
 * pulled since lines became an object. Fail at boot rather than silently
 * watch nothing.
 *
 * @returns {Promise<Set<string>>}
 */
async function readLocalLineCodes() {
  const lines_dir = linesDir(process.cwd());
  const factory_location = process.env.FACTORY_LOCATION;

  let lines;
  try {
    lines = await readJsonDir(lines_dir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    throw new Error(
      `watched-stations: ${lines_dir} does not exist. Lines own their location — ` +
        'run `al-orc lines pull --all && al-orc stations pull --all` in this repo.',
    );
  }

  const codes = new Set();
  for (const { file, config } of lines) {
    if (!config.code) throw new Error(`watched-stations: line file ${file} has no code`);
    if (config.location === factory_location) codes.add(config.code);
  }
  return codes;
}

/**
 * Read every station JSON whose line is served by this factory session's location.
 * @returns {Promise<{ file: string, config: object }[]>}
 */
async function readLocationStations() {
  const stations_dir = stationsDir(process.cwd());
  const local_line_codes = await readLocalLineCodes();
  const stations = await readJsonDir(stations_dir);

  const result = [];
  for (const { file, config } of stations) {
    if (!config.line) {
      throw new Error(`watched-stations: station "${config.short_code}" (${file}) has no line`);
    }
    if (!local_line_codes.has(config.line)) continue;
    result.push({ file, config });
  }
  return result;
}

/**
 * @returns {Promise<WatchedStation[]>}
 */
export async function resolveWatchedStations() {
  const stations = await readLocationStations();
  const watched = [];

  for (const { file, config } of stations) {
    if (config.watch_enabled !== true) continue;

    if (!config.id) {
      throw new Error(`watched-stations: station "${config.short_code}" (${file}) has no id — push it live first`);
    }

    const first_step = config.steps?.[0];
    const source_bin_path = first_step?.config?.source_bin;

    if (first_step?.slug !== 'lib-factory:move_files' || !source_bin_path) {
      // A line-head watching its inbox belongs to the intake watcher.
      if (first_step?.config?.watch_path) continue;
      throw new Error(
        `watched-stations: station "${config.short_code}" (${file}) has watch_enabled but neither a move_files step0 with source_bin nor a step0 watch_path to watch`,
      );
    }

    // Split on the FIRST slash only — everything after is the (possibly
    // nested, e.g. "output/approved") bin path, not just a single segment.
    const slash_index = source_bin_path.indexOf('/');
    const source_station = slash_index === -1 ? '' : source_bin_path.slice(0, slash_index);
    const source_bin = slash_index === -1 ? '' : source_bin_path.slice(slash_index + 1);
    if (!source_station || !source_bin) {
      throw new Error(
        `watched-stations: station "${config.short_code}" (${file}) has an unparseable source_bin "${source_bin_path}"`,
      );
    }

    watched.push({ station: config.short_code, station_id: config.id, source_station, source_bin });
  }

  return watched;
}

/**
 * Line-heads to intake-watch: `watch_enabled` stations whose step 0 is not a
 * `move_files` conveyor and carries a `watch_path` — the inbox folder or file
 * the line-head drains. A relative `watch_path` resolves against the factory
 * root, the same way steps resolve their own paths.
 *
 * Stations without a `watch_path` are left to resolveWatchedStations(), which
 * also raises the boot error for a `watch_enabled` station with neither.
 *
 * @returns {Promise<IntakeWatchedStation[]>}
 */
export async function resolveIntakeWatchedStations() {
  const stations = await readLocationStations();
  const watched = [];

  for (const { file, config } of stations) {
    if (config.watch_enabled !== true) continue;

    const first_step = config.steps?.[0];
    const watch_path = first_step?.config?.watch_path;
    if (first_step?.slug === 'lib-factory:move_files' || !watch_path) continue;

    if (!config.id) {
      throw new Error(`watched-stations: station "${config.short_code}" (${file}) has no id — push it live first`);
    }

    watched.push({
      station: config.short_code,
      station_id: config.id,
      watch_path: path.resolve(process.cwd(), watch_path),
    });
  }

  return watched;
}

/**
 * Upstream station codes that a station's conveyor pulls from — the first
 * segment of each `move_files` `source_bin` (single move or `moves` array).
 *
 * @param {any} config - A station file's contents.
 * @returns {string[]}
 */
function conveyorSources(config) {
  const first_step = config.steps?.[0];
  if (first_step?.slug !== 'lib-factory:move_files') return [];
  const moves = first_step.config?.moves ?? [first_step.config ?? {}];
  return moves.map(m => String(m.source_bin ?? '').split('/')[0]).filter(Boolean);
}

/**
 * Short_codes of stations that nothing will ever trigger: enabled, not
 * archived, with NEITHER `schedule_enabled` NOR `watch_enabled`, and either
 *
 *   - a conveyor (`move_files` step 0) — structurally eligible for bin-watch.
 *     This is the gap that let BK-SR sit fully dormant and unnoticed; or
 *   - a line-head that feeds a conveyor on this location — the gap that left
 *     BK-DI0 with no trigger at all.
 *
 * A station that feeds nothing and pulls nothing (a single-station line run by
 * hand) is not flagged. Disabled and archived stations are not flagged either
 * — those are already unambiguous.
 *
 * Informational only — this never throws, just reports.
 *
 * @returns {Promise<string[]>}
 */
export async function findUntriggeredStations() {
  const stations = await readLocationStations();
  const feeding = new Set(stations.flatMap(({ config }) => conveyorSources(config)));
  const untriggered = [];

  for (const { config } of stations) {
    if (config.is_enabled === false) continue;
    if (config.archived_at) continue;
    if (config.schedule_enabled === true || config.watch_enabled === true) continue;

    const is_conveyor = config.steps?.[0]?.slug === 'lib-factory:move_files';
    if (!is_conveyor && !feeding.has(config.short_code)) continue;

    untriggered.push(config.short_code);
  }

  return untriggered;
}
