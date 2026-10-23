import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Its own file: the shutdown flag is process-wide and is never cleared.
const tmp_root = fs.mkdtempSync(path.join(os.tmpdir(), 'workpiece-station-shutdown-test-'));
const original_cwd = process.cwd();
process.chdir(tmp_root);

const { processWorkpiece } = await import('../src/utils/workpiece-station.js');
const { markShuttingDown } = await import('../src/utils/shutdown.js');
const { bin } = await import('../src/factoryPaths.js');

after(() => {
  process.chdir(original_cwd);
  fs.rmSync(tmp_root, { recursive: true, force: true });
});

describe('processWorkpiece - failure while the session shuts down', () => {
  it('leaves the workpiece in input/ instead of moving it to failed/', async () => {
    const wp = path.join(bin('AR2', 'input'), 'arc-13');
    fs.mkdirSync(wp, { recursive: true });
    fs.writeFileSync(path.join(wp, 'pointer.json'), '{"workpiece_id":"arc-13"}');

    const result = await processWorkpiece({
      station: 'AR2',
      workpiece_id: 'arc-13',
      work_record_id: 'wr_1',
      body: async () => {
        markShuttingDown();
        throw new Error('rclone_failed: (no output)');
      },
    });

    assert.equal(result.status, 'failed');
    assert.ok(fs.existsSync(path.join(bin('AR2', 'input'), 'arc-13', 'pointer.json')), 'still in input/');
    assert.ok(!fs.existsSync(path.join(bin('AR2', 'failed'), 'arc-13')), 'not in failed/');
  });

  it('still promotes a workpiece that finished during shutdown', async () => {
    const wp = path.join(bin('AR2', 'input'), 'arc-14');
    fs.mkdirSync(wp, { recursive: true });
    fs.writeFileSync(path.join(wp, 'pointer.json'), '{"workpiece_id":"arc-14"}');

    const result = await processWorkpiece({
      station: 'AR2',
      workpiece_id: 'arc-14',
      work_record_id: 'wr_2',
      body: async () => 'uploaded',
    });

    assert.equal(result.status, 'ok');
    assert.ok(fs.existsSync(path.join(bin('AR2', 'done'), 'arc-14')));
    assert.ok(fs.existsSync(path.join(bin('AR2', 'output'), 'arc-14')));
  });
});
