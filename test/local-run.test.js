import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  runStepLocally,
  isLocalRun,
  loadStepOutputs,
  outputFilename,
  buildLocalTask,
  discoverFactorySteps,
} from '../src/local-run.js';
import { makeFixtureFactory, removeFixtureFactory } from './helpers/fixture-factory.js';

let root;
let original_cwd;
let original_fetch;
let fetch_calls;

beforeEach(() => {
  root = makeFixtureFactory();
  original_cwd = process.cwd();
  // attach* write relative to the cwd, as they do in a factory session.
  process.chdir(root);
  original_fetch = globalThis.fetch;
  fetch_calls = 0;
  globalThis.fetch = async () => {
    fetch_calls++;
    throw new Error('a local run must not call the orchestrator');
  };
  process.env.FIXTURE_SUFFIX = '!';
});

afterEach(() => {
  process.chdir(original_cwd);
  globalThis.fetch = original_fetch;
  delete process.env.FIXTURE_SUFFIX;
  removeFixtureFactory(root);
});

/** @param {string} rel */
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('isLocalRun', () => {
  it('is true only for local- ids', () => {
    assert.equal(isLocalRun('local-wr-1'), true);
    assert.equal(isLocalRun('wr_8f2k'), false);
  });
});

describe('buildLocalTask', () => {
  it('builds an orchestrator-shaped task with local- ids', () => {
    const task = buildLocalTask({ slug: 'x', config: { a: 1 }, step_outputs: { y: {} }, now: 42 });
    assert.deepEqual(task, {
      step_queue_id: 'local-42',
      step: { slug: 'x', config: { a: 1 } },
      work_record: { id: 'local-wr-42', step_outputs: { y: {} } },
      org_id: 'local',
    });
    assert.equal(isLocalRun(task.work_record.id), true);
  });
});

describe('outputFilename and loadStepOutputs', () => {
  it('maps / in a slug to __ and back', () => {
    assert.equal(outputFilename('acme/fetch'), 'acme__fetch.json');
    fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
    fs.writeFileSync(path.join(root, 'temp', 'acme__fetch.json'), '{"n":1}');
    assert.deepEqual(loadStepOutputs(path.join(root, 'temp')), { 'acme/fetch': { n: 1 } });
  });

  it('skips *.config.json and files that are not valid JSON', () => {
    const temp = path.join(root, 'temp');
    fs.mkdirSync(temp, { recursive: true });
    fs.writeFileSync(path.join(temp, 'good.json'), '{"ok":true}');
    fs.writeFileSync(path.join(temp, 'good.config.json'), '{}');
    fs.writeFileSync(path.join(temp, 'broken.json'), '{nope');
    assert.deepEqual(loadStepOutputs(temp), { good: { ok: true } });
  });

  it('is empty when temp/ does not exist', () => {
    assert.deepEqual(loadStepOutputs(path.join(root, 'missing')), {});
  });
});

describe('discoverFactorySteps', () => {
  it("finds the factory's steps and lib-factory's move_files", async () => {
    const steps = await discoverFactorySteps(root);
    assert.deepEqual(Object.keys(steps).sort(), ['A1_01_greet', 'B1_01_shout', 'lib-factory:move_files']);
  });

  it('throws outside a factory repo', async () => {
    await assert.rejects(discoverFactorySteps(path.join(root, 'src')), /No steps folder/);
  });
});

describe('runStepLocally', () => {
  it('runs a real step, saves its output and keeps attachments local', async () => {
    const { output, output_path } = await runStepLocally({ slug: 'A1_01_greet', config: { name: 'world' }, root });

    assert.equal(output.greeting, 'Hello, world');
    assert.equal(output.org_id, 'local');
    assert.ok(isLocalRun(output.work_record_id));
    assert.equal(output_path, path.join(root, 'temp', 'A1_01_greet.json'));
    assert.deepEqual(JSON.parse(read('temp/A1_01_greet.json')), output);

    const wr = path.join('temp', 'work_records', output.work_record_id);
    assert.equal(read(path.join(wr, 'Greeting.md')), 'Hello, world');
    assert.equal(read(path.join(wr, 'report.md')), '# Greeted world');
    assert.deepEqual(JSON.parse(read(path.join(wr, 'workpieces.json'))), { world: 'done' });
    assert.equal(fetch_calls, 0);
  });

  it("chains outputs: a later step's config reads an earlier step's output and the env", async () => {
    await runStepLocally({ slug: 'A1_01_greet', config: { name: 'acme' }, root });
    const { output, task } = await runStepLocally({
      slug: 'B1_01_shout',
      config: { text: '{{A1_01_greet.greeting}}', suffix: '{{env.FIXTURE_SUFFIX}}' },
      root,
    });
    assert.equal(output.shouted, 'HELLO, ACME!');
    assert.deepEqual(Object.keys(task.work_record.step_outputs), ['A1_01_greet']);
  });

  it('throws for an unknown step', async () => {
    await assert.rejects(runStepLocally({ slug: 'nope', root }), /Unknown step: nope/);
  });
});
