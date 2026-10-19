// @ts-check

/**
 * A throwaway copy of `test/fixtures/factory`, set up like a real factory repo: its
 * `node_modules/@assemblyline/lib-factory` links back to this repo, so the fixture's steps
 * import the same copy of the library the tests do.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'factory');

/**
 * @param {{ env?: string }} [opts] - `.env` contents for the copy
 * @returns {string} Absolute path of the copy (real path, no symlinks)
 */
export function makeFixtureFactory({ env = 'FIXTURE_SUFFIX=!\n' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lib-factory-fixture-')));
  fs.cpSync(FIXTURE, root, { recursive: true });
  const scope = path.join(root, 'node_modules', '@assemblyline');
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(REPO_ROOT, path.join(scope, 'lib-factory'), 'dir');
  fs.writeFileSync(path.join(root, '.env'), env);
  return root;
}

/** @param {string} root */
export function removeFixtureFactory(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
