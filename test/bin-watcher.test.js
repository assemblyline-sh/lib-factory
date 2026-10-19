import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmp_dir;

// Mock factoryPaths so bin() resolves to our tmp dir (same pattern as move_files_step.test.js)
mock.module('../src/factoryPaths.js', {
  namedExports: {
    bin: (station, type) => {
      const dir = path.join(tmp_dir, 'stations', station, type);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
  },
});

// Mock the orchestrator trigger calls we don't want
let hasInFlightRunImpl = async () => false;
let triggerStationRunImpl = async () => ({ work_record_id: 'wr1', job_id: 'job1' });
const hasInFlightRunCalls = [];
const triggerStationRunCalls = [];

mock.module('../src/utils/bin-watch-trigger.js', {
  namedExports: {
    hasInFlightRun: async (...args) => {
      hasInFlightRunCalls.push(args);
      return hasInFlightRunImpl(...args);
    },
    triggerStationRun: async (...args) => {
      triggerStationRunCalls.push(args);
      return triggerStationRunImpl(...args);
    },
  },
});

const { binHasWorkpieces, checkAndTrigger } = await import('../src/bin-watcher.js');

function mkdir_workpiece(rel_path) {
  const full = path.join(tmp_dir, rel_path);
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(path.join(full, 'pointer.json'), JSON.stringify({ workpiece_id: path.basename(full) }));
}

describe('binHasWorkpieces', () => {
  beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-watcher-'));
  });

  afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true });
  });

  it('returns true when the bin has a workpiece folder with a pointer.json', async () => {
    mkdir_workpiece('stations/CAR0/output/car-27');
    fs.writeFileSync(path.join(tmp_dir, 'stations/CAR0/output/.DS_Store'), '');

    const result = await binHasWorkpieces('CAR0', 'output');

    assert.equal(result, true);
  });

  it('returns false when the bin is empty', async () => {
    fs.mkdirSync(path.join(tmp_dir, 'stations/CAR0/output'), { recursive: true });

    const result = await binHasWorkpieces('CAR0', 'output');

    assert.equal(result, false);
  });

  it('ignores dotfiles and non-directory entries', async () => {
    const dir = path.join(tmp_dir, 'stations/CAR0/output');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'stray-file.txt'), '');

    const result = await binHasWorkpieces('CAR0', 'output');

    assert.equal(result, false);
  });

  it('ignores a folder without a pointer.json', async () => {
    fs.mkdirSync(path.join(tmp_dir, 'stations/CAR0/output/not-a-workpiece'), { recursive: true });

    const result = await binHasWorkpieces('CAR0', 'output');

    assert.equal(result, false);
  });

  it('ignores a dot-folder even when it has a pointer.json', async () => {
    mkdir_workpiece('stations/CAR0/output/.car-27');

    const result = await binHasWorkpieces('CAR0', 'output');

    assert.equal(result, false);
  });

  it('finds a workpiece alongside folders that are not workpieces', async () => {
    fs.mkdirSync(path.join(tmp_dir, 'stations/CAR0/output/extract'), { recursive: true });
    mkdir_workpiece('stations/CAR0/output/car-27');

    const result = await binHasWorkpieces('CAR0', 'output');

    assert.equal(result, true);
  });
});

describe('checkAndTrigger', () => {
  const watched = [{ station: 'CAR1', station_id: 'maaopXWtoU7I', source_station: 'CAR0', source_bin: 'output' }];

  beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-watcher-'));
    hasInFlightRunCalls.length = 0;
    triggerStationRunCalls.length = 0;
    hasInFlightRunImpl = async () => false;
    triggerStationRunImpl = async () => ({ work_record_id: 'wr1', job_id: 'job1' });
  });

  afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true });
  });

  it("triggers when the station's own input bin already has a backlog (upstream not even checked)", async () => {
    mkdir_workpiece('stations/CAR1/input/car-30');
    fs.mkdirSync(path.join(tmp_dir, 'stations/CAR0/output'), { recursive: true });

    await checkAndTrigger(watched);

    assert.equal(hasInFlightRunCalls.length, 1);
    assert.equal(hasInFlightRunCalls[0][0], 'maaopXWtoU7I');
    assert.equal(triggerStationRunCalls.length, 1);
    assert.equal(triggerStationRunCalls[0][0], 'maaopXWtoU7I');
  });

  it("triggers when the station's own input is empty but upstream has new work", async () => {
    fs.mkdirSync(path.join(tmp_dir, 'stations/CAR1/input'), { recursive: true });
    mkdir_workpiece('stations/CAR0/output/car-31');

    await checkAndTrigger(watched);

    assert.equal(triggerStationRunCalls.length, 1);
  });

  it('does not trigger when both own input and the upstream bin are empty', async () => {
    fs.mkdirSync(path.join(tmp_dir, 'stations/CAR1/input'), { recursive: true });
    fs.mkdirSync(path.join(tmp_dir, 'stations/CAR0/output'), { recursive: true });

    await checkAndTrigger(watched);

    assert.equal(hasInFlightRunCalls.length, 0);
    assert.equal(triggerStationRunCalls.length, 0);
  });

  it('does not trigger when a run is already in flight', async () => {
    mkdir_workpiece('stations/CAR1/input/car-30');
    hasInFlightRunImpl = async () => true;

    await checkAndTrigger(watched);

    assert.equal(triggerStationRunCalls.length, 0);
  });

  it('logs and continues past a failing station instead of throwing', async () => {
    const multi_watched = [
      { station: 'CAR1', station_id: 'maaopXWtoU7I', source_station: 'CAR0', source_bin: 'output' },
      { station: 'M1', station_id: 'm1StationId', source_station: 'M0', source_bin: 'output' },
    ];
    mkdir_workpiece('stations/CAR1/input/car-30');
    mkdir_workpiece('stations/M1/input/mus-1');
    // Simulate an orchestrator API failure for CAR1 specifically (e.g. a transient
    // network error on hasInFlightRun) — M1 should still proceed and trigger.
    hasInFlightRunImpl = async (station_id) => {
      if (station_id === 'maaopXWtoU7I') throw new Error('boom');
      return false;
    };

    const original_error = console.error;
    const error_lines = [];
    console.error = (msg) => error_lines.push(msg);
    try {
      await checkAndTrigger(multi_watched);
    } finally {
      console.error = original_error;
    }

    assert.equal(triggerStationRunCalls.length, 1);
    assert.equal(triggerStationRunCalls[0][0], 'm1StationId');
    assert.ok(error_lines.some(line => line.includes('CAR1') && line.includes('boom')));
  });
});
