import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock orchestrator (HTTP calls we don't want)
const getCalls = [];
const postCalls = [];
let getImpl = async () => ({ data: [] });
let postImpl = async () => ({ data: { work_record_id: 'wr1', job_id: 'job1' } });

mock.module('../../src/orchestrator.js', {
  namedExports: {
    orchestratorGet: async (...args) => {
      getCalls.push(args);
      return getImpl(...args);
    },
    orchestratorPost: async (...args) => {
      postCalls.push(args);
      return postImpl(...args);
    },
  },
});

const { hasInFlightRun, triggerStationRun } = await import('../../src/utils/bin-watch-trigger.js');

describe('hasInFlightRun', () => {
  beforeEach(() => {
    getCalls.length = 0;
    getImpl = async () => ({ data: [] });
  });

  it('returns false when no pending or running work records exist', async () => {
    const result = await hasInFlightRun('maaopXWtoU7I');

    assert.equal(result, false);
    assert.equal(getCalls.length, 2);
    assert.equal(getCalls[0][0], '/api/v1/work-records?station=maaopXWtoU7I&status=pending&limit=1');
    assert.equal(getCalls[1][0], '/api/v1/work-records?station=maaopXWtoU7I&status=running&limit=1');
  });

  it('returns true and short-circuits when a pending work record exists', async () => {
    getImpl = async () => ({ data: [{ id: 'wr1', status: 'pending' }] });

    const result = await hasInFlightRun('maaopXWtoU7I');

    assert.equal(result, true);
    assert.equal(getCalls.length, 1);
  });

  it('returns true when only a running work record exists (checks both statuses)', async () => {
    let call = 0;
    getImpl = async () => {
      call += 1;
      return call === 1 ? { data: [] } : { data: [{ id: 'wr2', status: 'running' }] };
    };

    const result = await hasInFlightRun('maaopXWtoU7I');

    assert.equal(result, true);
    assert.equal(getCalls.length, 2);
  });
});

describe('triggerStationRun', () => {
  beforeEach(() => {
    postCalls.length = 0;
    postImpl = async () => ({ data: { work_record_id: 'wr1', job_id: 'job1' } });
  });

  it('POSTs to the canonical station run endpoint and returns work_record_id/job_id', async () => {
    const result = await triggerStationRun('maaopXWtoU7I');

    assert.deepEqual(result, { work_record_id: 'wr1', job_id: 'job1' });
    assert.equal(postCalls.length, 1);
    assert.equal(postCalls[0][0], '/api/v1/stations/maaopXWtoU7I/run');
    assert.deepEqual(postCalls[0][1], {});
  });
});
