import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listStationFiles,
  findStation,
  findStationsWithStep,
  listScenarios,
  loadScenario,
  scenariosDir,
} from '../../src/utils/orchestrator-files.js';

let root;

/**
 * @param {string} filename
 * @param {object} station
 */
function writeStation(filename, station) {
  const dir = path.join(root, '.orchestrator', 'stations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(station));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-files-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('listStationFiles', () => {
  it('is empty when there is no stations folder', () => {
    assert.deepEqual(listStationFiles(root), []);
  });

  it('reads every .json file, sorted by name', () => {
    writeStation('B1__b.json', { short_code: 'B1' });
    writeStation('A1__a.json', { short_code: 'A1' });
    fs.writeFileSync(path.join(root, '.orchestrator', 'stations', 'notes.txt'), 'x');
    assert.deepEqual(listStationFiles(root).map(({ station }) => station.short_code), ['A1', 'B1']);
  });
});

describe('findStation', () => {
  beforeEach(() => {
    writeStation('A1__greet.json', { id: 'st-a1', short_code: 'A1', steps: [{ slug: 'x' }] });
    writeStation('st-b1__legacy.json', { id: 'st-b1', short_code: 'B1', steps: [{ slug: 'y' }] });
  });

  it('finds by filename prefix', () => {
    assert.equal(findStation(root, 'A1')?.station.id, 'st-a1');
    assert.equal(findStation(root, 'st-b1')?.station.short_code, 'B1');
  });

  it('falls back to the id or short_code inside the file', () => {
    assert.equal(findStation(root, 'st-a1')?.station.short_code, 'A1');
    assert.equal(findStation(root, 'B1')?.station.id, 'st-b1');
  });

  it('is null when nothing matches; a prefix of a code is not a match', () => {
    assert.equal(findStation(root, 'A'), null);
    assert.equal(findStation(root, 'Z9'), null);
  });
});

describe('findStationsWithStep', () => {
  it('returns the stations that run the step', () => {
    writeStation('A1__a.json', { short_code: 'A1', steps: [{ slug: 'x' }, { slug: 'y' }] });
    writeStation('B1__b.json', { short_code: 'B1', steps: [{ slug: 'y' }] });
    writeStation('C1__c.json', { short_code: 'C1' });
    assert.deepEqual(findStationsWithStep(root, 'y').map((s) => s.short_code), ['A1', 'B1']);
    assert.deepEqual(findStationsWithStep(root, 'z'), []);
  });
});

describe('scenarios', () => {
  it('keeps one folder per step, with / in the slug as __', () => {
    assert.equal(scenariosDir(root, 'acme/send'), path.join(root, '.orchestrator', 'scenarios', 'acme__send'));
  });

  it('lists and loads scenarios', () => {
    const dir = scenariosDir(root, 'acme/send');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'b.json'), '{"to":"b"}');
    fs.writeFileSync(path.join(dir, 'a.json'), '{"to":"a"}');
    assert.deepEqual(listScenarios(root, 'acme/send'), ['a', 'b']);
    assert.deepEqual(loadScenario(root, 'acme/send', 'b'), { to: 'b' });
  });

  it('is empty or null when nothing is saved', () => {
    assert.deepEqual(listScenarios(root, 'none'), []);
    assert.equal(loadScenario(root, 'none', 'x'), null);
  });
});
