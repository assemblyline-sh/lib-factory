import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmp_dir;

// Mock orchestrator (HTTP calls we don't want)
const attachReportCalls = [];
const attachDocumentCalls = [];
mock.module('../src/orchestrator.js', {
  namedExports: {
    attachReport: async (...args) => { attachReportCalls.push(args); },
    attachDocument: async (...args) => { attachDocumentCalls.push(args); },
  },
});

// Mock factoryPaths so bin() resolves to our tmp dir
mock.module('../src/factoryPaths.js', {
  namedExports: {
    bin: (station, type) => {
      const dir = path.join(tmp_dir, 'stations', station, type);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
  },
});

// Import step AFTER mocks are in place
const { default: moveFilesStep } = await import('../src/steps/move_files.js');

// ── Helpers ──────────────────────────────────────────────────

function mkfile(rel_path, content = '') {
  const full = path.join(tmp_dir, rel_path);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

/** A workpiece folder: rel_path/pointer.json */
function mkworkpiece(rel_path) {
  mkfile(path.join(rel_path, 'pointer.json'), '{}');
}

function exists(rel_path) {
  return fs.existsSync(path.join(tmp_dir, rel_path));
}

const mockContext = { work_record: { id: 'wr_test_123' }, step: { slug: 'lib-factory:move_files' } };

// ── Schema validation ────────────────────────────────────────

describe('move_files inputSchema', () => {
  it('accepts simple config', () => {
    const result = moveFilesStep.inputSchema.safeParse({
      source_bin: 'HI1/output',
      target_bin: 'HI3/input',
    });
    assert.ok(result.success);
    assert.equal(result.data.source_bin, 'HI1/output');
    assert.equal(result.data.batch_size, 100);
  });

  it('accepts moves array', () => {
    const result = moveFilesStep.inputSchema.safeParse({
      moves: [
        { source_bin: 'HI1/output', target_bin: 'HI3/input' },
        { source_bin: 'HI1/done', target_bin: 'HI3/input' },
      ],
    });
    assert.ok(result.success);
    assert.equal(result.data.moves.length, 2);
  });

  it('tolerates the legacy mode: "directories"', () => {
    const simple = moveFilesStep.inputSchema.safeParse({
      source_bin: 'HI1/output', target_bin: 'HI3/input', mode: 'directories',
    });
    const moves = moveFilesStep.inputSchema.safeParse({
      moves: [{ source_bin: 'HI1/output', target_bin: 'HI3/input', mode: 'directories' }],
    });
    assert.ok(simple.success);
    assert.ok(moves.success);
  });

  for (const [label, extra] of [
    ['mode: "files"', { mode: 'files' }],
    ['pattern', { pattern: '*.pdf' }],
    ['recursive', { recursive: true }],
  ]) {
    it(`rejects the removed files-mode option ${label}`, () => {
      const simple = moveFilesStep.inputSchema.safeParse({
        source_bin: 'HI1/output', target_bin: 'HI3/input', ...extra,
      });
      const moves = moveFilesStep.inputSchema.safeParse({
        moves: [{ source_bin: 'HI1/output', target_bin: 'HI3/input', ...extra }],
      });
      assert.ok(!simple.success);
      assert.ok(!moves.success);
    });
  }

  it('rejects empty moves array', () => {
    const result = moveFilesStep.inputSchema.safeParse({ moves: [] });
    assert.ok(!result.success);
  });

  it('rejects config without source_bin or moves', () => {
    const result = moveFilesStep.inputSchema.safeParse({ target_bin: 'HI3/input' });
    assert.ok(!result.success);
  });
});

// ── Execute ──────────────────────────────────────────────────

describe('move_files execute', () => {
  beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'move-files-step-'));
    attachReportCalls.length = 0;
    attachDocumentCalls.length = 0;
  });

  afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true });
  });

  it('simple config moves workpieces and attaches a document', async () => {
    mkworkpiece('stations/HI1/output/wp-a');
    mkworkpiece('stations/HI1/output/wp-b');
    mkfile('stations/HI1/output/stray.pdf');

    const result = await moveFilesStep.execute(
      { source_bin: 'HI1/output', target_bin: 'HI3/input', batch_size: 100 },
      mockContext,
    );

    assert.equal(result.moved_count, 2);
    assert.equal(result.total_available, 2);
    assert.deepEqual(result.entries, ['wp-a', 'wp-b']);
    assert.ok(exists('stations/HI3/input/wp-a/pointer.json'));
    assert.ok(!exists('stations/HI1/output/wp-a'));
    assert.ok(exists('stations/HI1/output/stray.pdf'));
    // Default: attachDocument (supporting document)
    assert.equal(attachDocumentCalls.length, 1);
    assert.equal(attachDocumentCalls[0][0], 'wr_test_123');
    assert.equal(attachDocumentCalls[0][1], 'Move Files');
    assert.equal(attachReportCalls.length, 0);
  });

  it('moves array with two moves aggregates counts', async () => {
    mkworkpiece('stations/HI1/output/a');
    mkworkpiece('stations/HI1/done/b');
    mkworkpiece('stations/HI1/done/c');

    const config = {
      moves: [
        { source_bin: 'HI1/output', target_bin: 'HI3/input', batch_size: 100 },
        { source_bin: 'HI1/done', target_bin: 'HI3/input', batch_size: 100 },
      ],
    };

    const result = await moveFilesStep.execute(config, mockContext);

    assert.equal(result.moved_count, 3);
    assert.equal(result.total_available, 3);
    assert.deepEqual(result.entries, ['a', 'b', 'c']);
    assert.ok(exists('stations/HI3/input/a'));
    assert.ok(exists('stations/HI3/input/b'));
    assert.ok(exists('stations/HI3/input/c'));
    assert.equal(attachDocumentCalls.length, 1);
    assert.equal(attachReportCalls.length, 0);
  });

  it('one move has nothing to transfer', async () => {
    // First source is empty (doesn't exist), second has a workpiece
    mkworkpiece('stations/HI1/done/x');

    const config = {
      moves: [
        { source_bin: 'HI1/output', target_bin: 'HI3/input', batch_size: 100 },
        { source_bin: 'HI1/done', target_bin: 'HI3/input', batch_size: 100 },
      ],
    };

    const result = await moveFilesStep.execute(config, mockContext);

    assert.equal(result.moved_count, 1);
    assert.equal(result.total_available, 1);
    assert.deepEqual(result.entries, ['x']);
  });

  it('report contains per-move breakdown', async () => {
    mkworkpiece('stations/HI1/output/a');
    mkworkpiece('stations/HI1/done/b');

    const config = {
      moves: [
        { source_bin: 'HI1/output', target_bin: 'HI3/input', batch_size: 100 },
        { source_bin: 'HI1/done', target_bin: 'HI3/input', batch_size: 100 },
      ],
    };

    await moveFilesStep.execute(config, mockContext);

    const content = attachDocumentCalls[0][2];
    assert.ok(content.includes('HI1/output'));
    assert.ok(content.includes('HI1/done'));
    assert.ok(content.includes('HI3/input'));
    assert.ok(content.includes('**Total moved**: 2 / 2 available'));
  });

  it('report: true uploads as report instead of document', async () => {
    mkworkpiece('stations/HI1/output/a');

    const result = await moveFilesStep.execute(
      { source_bin: 'HI1/output', target_bin: 'HI3/input', batch_size: 100, report: true },
      mockContext,
    );

    assert.equal(result.moved_count, 1);
    assert.equal(attachReportCalls.length, 1);
    assert.equal(attachReportCalls[0][0], 'wr_test_123');
    assert.equal(attachDocumentCalls.length, 0);
  });
});
