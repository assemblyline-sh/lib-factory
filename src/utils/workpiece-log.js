// @ts-check
import fs from 'node:fs';
import path from 'node:path';

/**
 * Append one event to `{wp}/log.jsonl`.
 *
 * Best-effort: a failed write logs to stderr and is swallowed so
 * instrumentation can never break the step's actual work.
 *
 * @param {string} wp - Workpiece directory; must already exist.
 * @param {string} station - Station short code, e.g. `VM0`, `VM2`.
 * @param {string} work_record_id - Work record id of the run emitting this event.
 * @param {string} event - Free-form event name, e.g. `station_started`.
 */
export function logEvent(wp, station, work_record_id, event) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    station,
    wr: work_record_id,
    event,
  }) + '\n';
  try {
    fs.appendFileSync(path.join(wp, 'log.jsonl'), line);
  } catch (err) {
    console.warn(
      `[workpiece-log] failed to append ${station}/${event} to ${wp}: ${err.message}`,
    );
  }
}
