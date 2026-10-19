/**
 * Standard factory repo path conventions.
 *
 * Two paths under temp/:
 *   temp/stations/{station}/{type}/     — assembly-line station bins
 *   temp/work_records/{work_record_id}/ — per-run scratch space
 *
 * All directories auto-create on first access.
 */

import path from 'node:path';
import fs from 'node:fs';

const BASE = process.cwd();
const STATIONS = path.join(BASE, 'temp', 'stations');
const WORK_RECORDS = path.join(BASE, 'temp', 'work_records');

/**
 * Resolve an assembly-line station bin path.
 *
 * @param {string} station - Process short code (e.g. 'HI1', 'CP1', 'ZP1')
 * @param {string} type - Lifecycle phase ('input', 'doing', 'output', 'done', 'failed')
 * @returns {string} Absolute path to the bin directory (auto-created)
 */
export function bin(station, ...segments) {
  const dir = path.join(STATIONS, station, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a per-work-record scratch directory.
 *
 * @param {string} work_record_id - Work record ID (e.g. 'wr_abc123')
 * @returns {string} Absolute path to the scratch directory (auto-created)
 */
export function workRecordDir(work_record_id) {
  const dir = path.join(WORK_RECORDS, work_record_id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a file path inside a work record's scratch directory.
 *
 * @param {string} work_record_id - Work record ID
 * @param {string} filename - File name
 * @returns {string} Absolute path to the file
 */
export function workRecordFile(work_record_id, filename) {
  return path.join(workRecordDir(work_record_id), filename);
}
