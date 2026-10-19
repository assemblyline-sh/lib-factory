import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { moveWorkpieces, listWorkpieces, isWorkpieceDir } from '../src/files.js';

let tmp_dir;

beforeEach(() => {
  tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movefiles-'));
});

afterEach(() => {
  fs.rmSync(tmp_dir, { recursive: true, force: true });
});

function mkfile(rel_path, content = '') {
  const full = path.join(tmp_dir, rel_path);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

/** A workpiece folder: rel_path/pointer.json */
function mkworkpiece(rel_path) {
  mkfile(path.join(rel_path, 'pointer.json'), JSON.stringify({ workpiece_id: path.basename(rel_path) }));
}

function exists(rel_path) {
  return fs.existsSync(path.join(tmp_dir, rel_path));
}

function read(rel_path) {
  return fs.readFileSync(path.join(tmp_dir, rel_path), 'utf8');
}

function move(extra = {}) {
  return moveWorkpieces({
    source_dir: path.join(tmp_dir, 'src'),
    target_dir: path.join(tmp_dir, 'dst'),
    ...extra,
  });
}

// ── isWorkpieceDir / listWorkpieces ──────────────────────────

describe('isWorkpieceDir', () => {
  it('is true for a folder with a pointer.json', () => {
    mkworkpiece('wp-1');
    assert.equal(isWorkpieceDir(path.join(tmp_dir, 'wp-1')), true);
  });

  it('is false for a folder without one', () => {
    mkfile('extract/wp-1/pointer.json', '{}');
    assert.equal(isWorkpieceDir(path.join(tmp_dir, 'extract')), false);
  });
});

describe('listWorkpieces', () => {
  it('lists workpieces sorted, skipping loose files, dot-folders and folders without a pointer', () => {
    mkworkpiece('bin/wp-2');
    mkworkpiece('bin/wp-1');
    mkworkpiece('bin/.hidden');
    mkfile('bin/stray.pdf');
    mkfile('bin/sub-bin/wp-3/pointer.json', '{}');

    assert.deepEqual(listWorkpieces(path.join(tmp_dir, 'bin')), ['wp-1', 'wp-2']);
  });

  it('returns [] for a missing bin', () => {
    assert.deepEqual(listWorkpieces(path.join(tmp_dir, 'nope')), []);
  });
});

// ── moveWorkpieces ───────────────────────────────────────────

describe('moveWorkpieces', () => {
  it('moves workpieces with their contents', () => {
    mkworkpiece('src/wp-a');
    mkfile('src/wp-a/_pages/p1.pdf', 'pdf1');
    mkworkpiece('src/wp-b');

    const result = move();

    assert.equal(result.moved_count, 2);
    assert.deepEqual(result.entries, ['wp-a', 'wp-b']);
    assert.equal(read('dst/wp-a/_pages/p1.pdf'), 'pdf1');
    assert.ok(exists('dst/wp-b/pointer.json'));
    assert.ok(!exists('src/wp-a'));
  });

  it('leaves loose files, sub-bins and folders without a pointer behind', () => {
    mkworkpiece('src/wp-a');
    mkfile('src/stray.pdf');
    mkfile('src/no-pointer/file.txt');
    mkworkpiece('src/sub-bin/wp-b');

    const result = move();

    assert.deepEqual(result.entries, ['wp-a']);
    assert.ok(exists('src/stray.pdf'));
    assert.ok(exists('src/no-pointer/file.txt'));
    assert.ok(exists('src/sub-bin/wp-b/pointer.json'));
  });

  it('merges into a workpiece that already exists in the target', () => {
    mkworkpiece('dst/wp');
    mkfile('dst/wp/_pages/p1.txt', 'text1');
    mkworkpiece('src/wp');
    mkfile('src/wp/_pages/p1.pdf', 'pdf1');
    mkfile('src/wp/sub2/c.txt', 'c');

    const result = move();

    assert.equal(result.moved_count, 1);
    assert.equal(read('dst/wp/_pages/p1.txt'), 'text1');
    assert.equal(read('dst/wp/_pages/p1.pdf'), 'pdf1');
    assert.equal(read('dst/wp/sub2/c.txt'), 'c');
    assert.ok(!exists('src/wp'));
  });

  it('respects batch_size', () => {
    mkworkpiece('src/a');
    mkworkpiece('src/b');
    mkworkpiece('src/c');

    const result = move({ batch_size: 2 });

    assert.equal(result.moved_count, 2);
    assert.equal(result.total_available, 3);
    assert.ok(exists('src/c'));
  });

  it('returns an empty result for a missing or empty source', () => {
    assert.deepEqual(move(), { moved_count: 0, total_available: 0, entries: [] });
    fs.mkdirSync(path.join(tmp_dir, 'src'));
    assert.deepEqual(move(), { moved_count: 0, total_available: 0, entries: [] });
    assert.ok(!exists('dst'));
  });
});
