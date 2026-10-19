// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { bin } from '../factoryPaths.js';
import { logEvent } from './workpiece-log.js';

const STATIONS_DIR = path.join(process.cwd(), 'temp', 'stations');

/**
 * @template T
 * @typedef {{ status: 'ok', value: T } | { status: 'failed', error: Error }} RunResult
 */

/**
 * Run a per-workpiece step under the 5-bin doing-bin contract.
 *
 *   1. Copy input/{workpiece_id}/ → doing/{workpiece_id}/ (full content,
 *      replacing any stranded doing/ copy left by a crash mid-run — a fresh
 *      start always reprocesses from input, never resumes doing/)
 *   2. Emit station_started to doing/log.jsonl
 *   3. Call body(wp_doing) — mutates the doing-bin working copy, returns value
 *   4a. Success: emit station_complete, doing → output (replacing any prior
 *       partial), input → done (replacing any prior done copy — a manual
 *       retry re-processes a workpiece already sitting in done/)
 *   4b. Failure: emit station_failed, input → failed (pristine), overlay log
 *       from doing, write error.txt, rm -rf doing
 *
 * @template T
 * @param {object} args
 * @param {string} args.station         - Station short code (e.g. 'VM2')
 * @param {string} args.workpiece_id    - Workpiece directory name
 * @param {string} args.work_record_id  - WR id; tagged on every auto-emitted log event
 * @param {(wp_doing: string) => Promise<T>} args.body
 * @returns {Promise<RunResult<T>>}
 */
export async function processWorkpiece({ station, workpiece_id, work_record_id, body }) {
  const wp_input  = path.join(bin(station, 'input'),  workpiece_id);
  const wp_doing  = path.join(bin(station, 'doing'),  workpiece_id);
  const wp_output = path.join(bin(station, 'output'), workpiece_id);
  const wp_done   = path.join(bin(station, 'done'),   workpiece_id);
  const wp_failed = path.join(bin(station, 'failed'), workpiece_id);

  if (fs.existsSync(wp_doing)) {
    fs.rmSync(wp_doing, { recursive: true, force: true });
  }
  fs.cpSync(wp_input, wp_doing, { recursive: true });
  logEvent(wp_doing, station, work_record_id, 'station_started');

  try {
    const value = await body(wp_doing);
    logEvent(wp_doing, station, work_record_id, 'station_complete');

    if (fs.existsSync(wp_output)) {
      fs.rmSync(wp_output, { recursive: true, force: true });
    }
    fs.renameSync(wp_doing, wp_output);

    if (fs.existsSync(wp_done)) {
      fs.rmSync(wp_done, { recursive: true, force: true });
    }
    fs.renameSync(wp_input, wp_done);

    return { status: 'ok', value };
  } catch (err) {
    logEvent(wp_doing, station, work_record_id, 'station_failed');
    promoteToFailed({ wp_input, wp_doing, wp_failed, err });
    return { status: 'failed', error: err };
  }
}

/**
 * Sweep every station's `doing/` bin and remove stranded workpieces.
 *
 * A workpiece in `doing/` means the factory session crashed mid-step. The original
 * input is still in `input/` (untouched until the success or failure
 * promotion renames), so the safe recovery is simply to discard the
 * partial doing copy — the next run reprocesses from input.
 *
 * Call once when the factory session starts, before any processing begins. Skips if the
 * stations directory doesn't exist yet (first run).
 *
 * @returns {string[]} `station/workpiece_id` paths that were cleaned up.
 */
export function cleanupOrphanedDoing() {
  if (!fs.existsSync(STATIONS_DIR)) return [];

  const cleaned = [];
  for (const station of fs.readdirSync(STATIONS_DIR, { withFileTypes: true })) {
    if (!station.isDirectory() || station.name.startsWith('.')) continue;
    const doing_bin = path.join(STATIONS_DIR, station.name, 'doing');
    if (!fs.existsSync(doing_bin)) continue;

    for (const wp of fs.readdirSync(doing_bin, { withFileTypes: true })) {
      if (!wp.isDirectory() || wp.name.startsWith('.')) continue;
      fs.rmSync(path.join(doing_bin, wp.name), { recursive: true, force: true });
      cleaned.push(`${station.name}/${wp.name}`);
    }
  }
  return cleaned;
}

/**
 * @param {object} args
 * @param {string} args.wp_input
 * @param {string} args.wp_doing
 * @param {string} args.wp_failed
 * @param {Error} args.err
 */
function promoteToFailed({ wp_input, wp_doing, wp_failed, err }) {
  if (fs.existsSync(wp_failed)) {
    fs.rmSync(wp_failed, { recursive: true, force: true });
  }
  fs.renameSync(wp_input, wp_failed);

  const doing_log = path.join(wp_doing, 'log.jsonl');
  if (fs.existsSync(doing_log)) {
    fs.copyFileSync(doing_log, path.join(wp_failed, 'log.jsonl'));
  }

  const failed_at = new Date().toISOString();
  const error_json = serializeError(err, failed_at);
  fs.writeFileSync(
    path.join(wp_failed, 'error.json'),
    JSON.stringify(error_json, null, 2),
  );
  fs.writeFileSync(
    path.join(wp_failed, 'error.txt'),
    renderErrorText(error_json),
  );

  fs.rmSync(wp_doing, { recursive: true, force: true });
}

// Cap body length in the human-readable view only; full body lives in error.json.
const ERROR_TXT_BODY_MAX = 500;

/**
 * Capture an Error in a structured form: standard Error fields plus any own
 * enumerable properties step code attached (e.g. `status`, `headers`, `body`,
 * `cause`). Used to produce both `error.json` and `error.txt`.
 *
 * @param {Error} err
 * @param {string} failed_at
 * @returns {Record<string, unknown>}
 */
function serializeError(err, failed_at) {
  /** @type {Record<string, unknown>} */
  const out = {
    failed_at,
    name: err.name || 'Error',
    message: err.message,
    stack: err.stack,
  };
  for (const key of Object.getOwnPropertyNames(err)) {
    if (key === 'name' || key === 'message' || key === 'stack') continue;
    out[key] = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (err))[key];
  }
  return out;
}

/** @param {Record<string, unknown>} e */
function renderErrorText(e) {
  const lines = [String(e.failed_at), `${e.name}: ${e.message}`];
  for (const key of Object.keys(e)) {
    if (['failed_at', 'name', 'message', 'stack', 'body'].includes(key)) continue;
    lines.push(`${key}: ${formatField(e[key])}`);
  }
  if (typeof e.body === 'string' && e.body.length > 0) {
    lines.push(`body: ${truncate(e.body, ERROR_TXT_BODY_MAX)}`);
  }
  if (e.stack) lines.push('', stripStackMessage(String(e.stack), String(e.name), String(e.message)));
  return lines.join('\n');
}

// V8's err.stack begins with "Name: message\n    at ...". We render Name +
// message on its own summary line above, so strip the leading line from
// stack to avoid duplication.
/** @param {string} stack @param {string} name @param {string} message */
function stripStackMessage(stack, name, message) {
  const header = `${name}: ${message}`;
  return stack.startsWith(header) ? stack.slice(header.length).replace(/^\n/, '') : stack;
}

/** @param {unknown} v */
function formatField(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** @param {string} s @param {number} max */
function truncate(s, max) {
  return s.length <= max ? s : `${s.slice(0, max)}…[+${s.length - max} chars, see error.json]`;
}
