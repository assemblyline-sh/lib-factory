/**
 * Workpiece movement between station bins.
 *
 * A workpiece is a non-dot directory carrying a `pointer.json`. Bins move
 * whole workpieces, never loose files: the conveyor (`move_files`) and the
 * bin-watcher both use isWorkpieceDir(), so the watcher only triggers on
 * what the conveyor will actually move.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * True when dir is a workpiece: a directory holding a `pointer.json`. Sub-bins
 * (e.g. `output/extract/`) hold workpieces but carry no pointer themselves.
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function isWorkpieceDir(dir) {
  return fs.existsSync(path.join(dir, 'pointer.json'));
}

/**
 * Names of the workpieces directly inside bin_dir, sorted. Empty when the bin
 * doesn't exist.
 *
 * @param {string} bin_dir
 * @returns {string[]}
 */
export function listWorkpieces(bin_dir) {
  if (!fs.existsSync(bin_dir)) return [];
  return fs
    .readdirSync(bin_dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && isWorkpieceDir(path.join(bin_dir, d.name)))
    .map(d => d.name)
    .sort();
}

/**
 * Recursively merge src directory into dst, then remove src.
 * Files in src are moved into dst; subdirectories are merged recursively.
 */
function mergeDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      mergeDir(s, d);
    } else {
      fs.renameSync(s, d);
    }
  }
  fs.rmSync(src, { recursive: true });
}

/**
 * Move workpieces from source_dir to target_dir, oldest name first. A
 * workpiece whose name already exists in target_dir is merged into it.
 *
 * @param {object} options
 * @param {string} options.source_dir - Absolute path to the source bin
 * @param {string} options.target_dir - Absolute path to the target bin
 * @param {number} [options.batch_size=100] - Max workpieces to move per call
 * @returns {{ moved_count: number, total_available: number, entries: string[] }}
 */
export function moveWorkpieces({ source_dir, target_dir, batch_size = 100 } = {}) {
  const all_entries = listWorkpieces(source_dir);
  if (all_entries.length === 0) {
    return { moved_count: 0, total_available: 0, entries: [] };
  }

  const batch = all_entries.slice(0, batch_size);

  fs.mkdirSync(target_dir, { recursive: true });

  for (const entry of batch) {
    const src = path.join(source_dir, entry);
    const dst = path.join(target_dir, entry);

    if (fs.existsSync(dst)) {
      mergeDir(src, dst);
    } else {
      fs.renameSync(src, dst);
    }
  }

  return { moved_count: batch.length, total_available: all_entries.length, entries: batch };
}
