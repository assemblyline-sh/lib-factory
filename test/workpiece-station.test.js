import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// `bin()` in factoryPaths.js captures `process.cwd()` at module-load time.
// We must chdir into a tmp dir BEFORE importing the modules under test.
const tmp_root = fs.mkdtempSync(path.join(os.tmpdir(), 'workpiece-station-test-'));
const original_cwd = process.cwd();
process.chdir(tmp_root);

const { processWorkpiece } = await import('../src/utils/workpiece-station.js');
const { bin } = await import('../src/factoryPaths.js');

after(() => {
  process.chdir(original_cwd);
  fs.rmSync(tmp_root, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset bins under tmp_root before each test
  const stations_dir = path.join(tmp_root, 'temp', 'stations');
  if (fs.existsSync(stations_dir)) {
    fs.rmSync(stations_dir, { recursive: true, force: true });
  }
});

function seedInput(station, workpiece_id, files = {}) {
  const wp = path.join(bin(station, 'input'), workpiece_id);
  fs.mkdirSync(wp, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(wp, name), content);
  }
  return wp;
}

describe('processWorkpiece - failure capture', () => {
  it('writes error.json with all enumerable error fields', async () => {
    seedInput('TST', 'wp1', { 'pointer.json': '{"id":"wp1"}' });

    const result = await processWorkpiece({
      station: 'TST',
      workpiece_id: 'wp1',
      work_record_id: 'wr_test1',
      body: async () => {
        throw Object.assign(new Error('Upstream 502 Bad Gateway'), {
          status: 502,
          statusText: 'Bad Gateway',
          headers: '{cf-ray=abc; retry-after=60}',
          body: '<html>...long body...</html>',
        });
      },
    });

    assert.equal(result.status, 'failed');

    const error_json_path = path.join(bin('TST', 'failed'), 'wp1', 'error.json');
    assert.ok(fs.existsSync(error_json_path), 'error.json should exist');
    const json = JSON.parse(fs.readFileSync(error_json_path, 'utf8'));

    assert.equal(json.name, 'Error');
    assert.equal(json.message, 'Upstream 502 Bad Gateway');
    assert.equal(json.status, 502);
    assert.equal(json.statusText, 'Bad Gateway');
    assert.equal(json.headers, '{cf-ray=abc; retry-after=60}');
    assert.equal(json.body, '<html>...long body...</html>');
    assert.ok(json.failed_at);
    assert.ok(json.stack);
  });

  it('writes human-readable error.txt with field summary and truncated body', async () => {
    const long_body = 'X'.repeat(600);
    seedInput('TST', 'wp2', { 'pointer.json': '{}' });

    await processWorkpiece({
      station: 'TST',
      workpiece_id: 'wp2',
      work_record_id: 'wr_test2',
      body: async () => {
        throw Object.assign(new Error('boom'), {
          status: 502,
          body: long_body,
        });
      },
    });

    const txt = fs.readFileSync(
      path.join(bin('TST', 'failed'), 'wp2', 'error.txt'),
      'utf8',
    );

    assert.match(txt, /Error: boom/, 'name + message present');
    assert.match(txt, /status: 502/, 'status field present');
    assert.match(txt, /body: X{500}…\[\+100 chars, see error\.json\]/, 'body truncated with pointer to JSON');
    assert.match(txt, /at /, 'stack trace present');

    // Message must not appear twice (stack already includes it)
    const message_occurrences = txt.split('Error: boom').length - 1;
    assert.equal(message_occurrences, 1, 'message should appear once, not duplicated by an extra line');
  });

  it('handles errors with no extra fields (just message + stack)', async () => {
    seedInput('TST', 'wp3', {});

    await processWorkpiece({
      station: 'TST',
      workpiece_id: 'wp3',
      work_record_id: 'wr_test3',
      body: async () => { throw new Error('plain failure'); },
    });

    const failed_dir = path.join(bin('TST', 'failed'), 'wp3');
    const json = JSON.parse(fs.readFileSync(path.join(failed_dir, 'error.json'), 'utf8'));
    assert.equal(json.message, 'plain failure');
    assert.ok(json.stack);
    assert.equal(json.body, undefined);

    const txt = fs.readFileSync(path.join(failed_dir, 'error.txt'), 'utf8');
    assert.match(txt, /Error: plain failure/);
    assert.doesNotMatch(txt, /body:/, 'no body line when err.body absent');
  });
});

describe('processWorkpiece - rerun overwrite', () => {
  it('overwrites a prior done/ copy on manual retry instead of failing with ENOTEMPTY', async () => {
    seedInput('TST', 'wp_retry', { 'pointer.json': '{"id":"wp_retry"}' });

    const first = await processWorkpiece({
      station: 'TST',
      workpiece_id: 'wp_retry',
      work_record_id: 'wr_retry_1',
      body: async () => ({ ok: true }),
    });
    assert.equal(first.status, 'ok');

    // Simulate a manual retry: re-seed input (as if copied back from done/),
    // leaving the earlier run's done/wp_retry in place.
    seedInput('TST', 'wp_retry', { 'pointer.json': '{"id":"wp_retry"}' });

    const second = await processWorkpiece({
      station: 'TST',
      workpiece_id: 'wp_retry',
      work_record_id: 'wr_retry_2',
      body: async () => ({ ok: true }),
    });

    assert.equal(second.status, 'ok', 'retry must succeed, not be misfiled to failed/ on ENOTEMPTY');
    assert.ok(fs.existsSync(path.join(bin('TST', 'done'), 'wp_retry')));
    assert.ok(!fs.existsSync(bin('TST', 'input') && path.join(bin('TST', 'input'), 'wp_retry')));
  });
});

describe('processWorkpiece - stranded doing/ recovery', () => {
  it('overwrites a stranded doing/ copy (crash mid-run) and reprocesses cleanly from input', async () => {
    seedInput('TST', 'wp_crash', { 'pointer.json': '{"id":"wp_crash"}' });

    // Simulate a stranded doing/ dir from a prior crashed attempt: stale
    // log.jsonl plus a leftover file that no longer exists in input/.
    const wp_doing = path.join(bin('TST', 'doing'), 'wp_crash');
    fs.mkdirSync(wp_doing, { recursive: true });
    fs.writeFileSync(path.join(wp_doing, 'log.jsonl'), '{"event":"station_started","wr":"wr_stale"}\n');
    fs.writeFileSync(path.join(wp_doing, 'stale-artifact.md'), 'leftover from crashed run');

    const result = await processWorkpiece({
      station: 'TST',
      workpiece_id: 'wp_crash',
      work_record_id: 'wr_crash_retry',
      body: async (wp_doing_path) => {
        assert.ok(!fs.existsSync(path.join(wp_doing_path, 'stale-artifact.md')), 'stale doing/ content must not survive into the fresh run');
        return { ok: true };
      },
    });

    assert.equal(result.status, 'ok');

    const log_path = path.join(bin('TST', 'output'), 'wp_crash', 'log.jsonl');
    const lines = fs.readFileSync(log_path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      lines.map((l) => [l.event, l.wr]),
      [
        ['station_started', 'wr_crash_retry'],
        ['station_complete', 'wr_crash_retry'],
      ],
      'log.jsonl must be fresh, not the stale overlay from the crashed attempt',
    );
    assert.ok(!fs.existsSync(path.join(bin('TST', 'output'), 'wp_crash', 'stale-artifact.md')));
  });
});

describe('processWorkpiece - log.jsonl', () => {
  it('tags every auto-emitted event with the work_record_id (success path)', async () => {
    seedInput('TST', 'wp_ok', { 'pointer.json': '{"id":"wp_ok"}' });

    const result = await processWorkpiece({
      station: 'TST',
      workpiece_id: 'wp_ok',
      work_record_id: 'wr_success_abc',
      body: async () => ({ ok: true }),
    });

    assert.equal(result.status, 'ok');

    const log_path = path.join(bin('TST', 'output'), 'wp_ok', 'log.jsonl');
    const lines = fs.readFileSync(log_path, 'utf8').trim().split('\n').map(JSON.parse);

    assert.equal(lines.length, 2, 'expect station_started + station_complete');
    assert.deepEqual(
      lines.map((l) => [l.event, l.wr, l.station]),
      [
        ['station_started', 'wr_success_abc', 'TST'],
        ['station_complete', 'wr_success_abc', 'TST'],
      ],
    );
  });

  it('tags every auto-emitted event with the work_record_id (failure path)', async () => {
    seedInput('TST', 'wp_fail', { 'pointer.json': '{}' });

    await processWorkpiece({
      station: 'TST',
      workpiece_id: 'wp_fail',
      work_record_id: 'wr_fail_xyz',
      body: async () => { throw new Error('boom'); },
    });

    const log_path = path.join(bin('TST', 'failed'), 'wp_fail', 'log.jsonl');
    const lines = fs.readFileSync(log_path, 'utf8').trim().split('\n').map(JSON.parse);

    assert.equal(lines.length, 2, 'expect station_started + station_failed');
    assert.deepEqual(
      lines.map((l) => [l.event, l.wr]),
      [
        ['station_started', 'wr_fail_xyz'],
        ['station_failed', 'wr_fail_xyz'],
      ],
    );
  });
});
