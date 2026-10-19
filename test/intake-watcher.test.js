import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmp_dir;

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

const { pathHasWork, checkAndTriggerIntake } = await import('../src/intake-watcher.js');

/** @param {string} rel_path */
function abs(rel_path) {
  return path.join(tmp_dir, rel_path);
}

/**
 * @param {string} rel_path
 * @param {string} [content]
 */
function mkfile(rel_path, content = '') {
  fs.mkdirSync(path.dirname(abs(rel_path)), { recursive: true });
  fs.writeFileSync(abs(rel_path), content);
}

beforeEach(() => {
  tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-watcher-'));
});

afterEach(() => {
  fs.rmSync(tmp_dir, { recursive: true, force: true });
});

describe('pathHasWork', () => {
  it('is false for a missing path', async () => {
    assert.equal(await pathHasWork(abs('nope')), false);
  });

  it('is false for an empty file and true for a non-empty one', async () => {
    mkfile('inbox.txt');
    assert.equal(await pathHasWork(abs('inbox.txt')), false);

    mkfile('inbox.txt', 'https://www.carwale.com/used/123\n');
    assert.equal(await pathHasWork(abs('inbox.txt')), true);
  });

  it('is false for an empty folder or one holding only dot entries', async () => {
    fs.mkdirSync(abs('inbox'));
    assert.equal(await pathHasWork(abs('inbox')), false);

    mkfile('inbox/.DS_Store');
    fs.mkdirSync(abs('inbox/.hidden'));
    assert.equal(await pathHasWork(abs('inbox')), false);
  });

  it('is true for a folder holding a file or a subfolder', async () => {
    mkfile('inbox/invoice.pdf', 'pdf');
    assert.equal(await pathHasWork(abs('inbox')), true);

    fs.rmSync(abs('inbox/invoice.pdf'));
    fs.mkdirSync(abs('inbox/march'));
    assert.equal(await pathHasWork(abs('inbox')), true);
  });
});

describe('checkAndTriggerIntake', () => {
  beforeEach(() => {
    hasInFlightRunImpl = async () => false;
    triggerStationRunImpl = async () => ({ work_record_id: 'wr1', job_id: 'job1' });
    hasInFlightRunCalls.length = 0;
    triggerStationRunCalls.length = 0;
  });

  it('triggers a line-head whose inbox has work', async () => {
    mkfile('inbox/invoice.pdf', 'pdf');

    await checkAndTriggerIntake([{ station: 'BK-DI0', station_id: 'bkdi0id', watch_path: abs('inbox') }]);

    assert.deepEqual(hasInFlightRunCalls, [['bkdi0id']]);
    assert.deepEqual(triggerStationRunCalls, [['bkdi0id']]);
  });

  it('does not trigger, or ask the orchestrator, when the inbox is empty', async () => {
    mkfile('inbox.txt');

    await checkAndTriggerIntake([{ station: 'CAR0', station_id: 'car0id', watch_path: abs('inbox.txt') }]);

    assert.equal(hasInFlightRunCalls.length, 0);
    assert.equal(triggerStationRunCalls.length, 0);
  });

  it('does not trigger when a run is already in flight', async () => {
    mkfile('inbox.txt', 'https://www.carwale.com/used/123\n');
    hasInFlightRunImpl = async () => true;

    await checkAndTriggerIntake([{ station: 'CAR0', station_id: 'car0id', watch_path: abs('inbox.txt') }]);

    assert.equal(triggerStationRunCalls.length, 0);
  });

  it('logs and continues past a failing station instead of throwing', async () => {
    mkfile('car/inbox.txt', 'url\n');
    mkfile('music/input.txt', 'url\n');
    triggerStationRunImpl = async station_id => {
      if (station_id === 'car0id') throw new Error('orchestrator down');
      return { work_record_id: 'wr2', job_id: 'job2' };
    };

    await checkAndTriggerIntake([
      { station: 'CAR0', station_id: 'car0id', watch_path: abs('car/inbox.txt') },
      { station: 'M0', station_id: 'm0id', watch_path: abs('music/input.txt') },
    ]);

    assert.deepEqual(triggerStationRunCalls, [['car0id'], ['m0id']]);
  });
});
