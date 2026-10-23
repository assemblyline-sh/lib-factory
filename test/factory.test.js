// @ts-check
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Exit, deferred, until, startFakeOrchestrator, controllableHandlers } from './helpers/fake-orchestrator.js';

/**
 * startFactory against a fake orchestrator over real HTTP (test/helpers/fake-orchestrator.js).
 *
 * Each test imports a fresh copy of src/factory.js (query string) because the module
 * keeps session state. process.exit is mocked to throw, which ends startFactory.
 */

// The shutdown flag is process-wide and every test ends by shutting a session down,
// so each test gets its own copy of the flag.
let is_shutting_down = false;
mock.module('../src/utils/shutdown.js', {
  namedExports: {
    markShuttingDown: () => { is_shutting_down = true; },
    isShuttingDown: () => is_shutting_down,
  },
});

/** Method mocks, restored after each test. (mock.restoreAll would also drop the module mock above.) */
let method_mocks = [];
function mockMethod(object, name, implementation) {
  method_mocks.push(mock.method(object, name, implementation));
}

let import_count = 0;
async function importFactory() {
  import_count++;
  return import(`../src/factory.js?instance=${import_count}`);
}

const ENV_KEYS = ['ORCHESTRATOR_URL', 'ORCHESTRATOR_API_KEY', 'ORCHESTRATOR_API_SECRET', 'FACTORY_LOCATION', 'POLL_INTERVAL_MS'];
let saved_env;
let signal_listeners;
let fake;

beforeEach(() => {
  is_shutting_down = false;
  saved_env = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  signal_listeners = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
  mockMethod(console, 'log', () => {});
  mockMethod(console, 'error', () => {});
  mockMethod(process, 'exit', (code) => { throw new Exit(code); });
});

afterEach(async () => {
  for (const m of method_mocks.reverse()) m.mock.restore();
  method_mocks = [];
  for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    for (const l of process.listeners(sig)) if (!signal_listeners[sig].includes(l)) process.removeListener(sig, l);
  }
  for (const k of ENV_KEYS) {
    if (saved_env[k] === undefined) delete process.env[k];
    else process.env[k] = saved_env[k];
  }
  if (fake) await fake.stop();
  fake = null;
});

/** @param {string} url */
function setEnv(url) {
  process.env.ORCHESTRATOR_URL = url;
  process.env.ORCHESTRATOR_API_KEY = 'key';
  process.env.ORCHESTRATOR_API_SECRET = 'secret';
  process.env.FACTORY_LOCATION = 'laptop1';
  process.env.POLL_INTERVAL_MS = '5';
}

describe('startFactory — steps run side by side, one task per step', () => {
  it('runs a second step while a long step is still running', async () => {
    fake = await startFakeOrchestrator([
      { id: 'sq_upload', slug: 'AR2_01_move_to_b2' },
      { id: 'sq_ingest', slug: 'AR0_01_ingest_paths' },
    ]);
    setEnv(fake.url);
    const { state, getHandler } = controllableHandlers(['AR2_01_move_to_b2', 'AR0_01_ingest_paths']);
    const { startFactory } = await importFactory();
    const session = startFactory({ getHandler });

    await until(() => state.AR0_01_ingest_paths.started.length === 1);
    assert.equal(state.AR2_01_move_to_b2.running, 1, 'the upload is still running');

    state.AR0_01_ingest_paths.gates[0].resolve();
    await until(() => fake.queue.find((s) => s.id === 'sq_ingest').status === 'completed');
    assert.equal(fake.queue.find((s) => s.id === 'sq_upload').status, 'claimed');

    state.AR2_01_move_to_b2.gates[0].resolve();
    await until(() => fake.queue.find((s) => s.id === 'sq_upload').status === 'completed');

    fake.closeSession();
    await assert.rejects(session, (e) => e instanceof Exit && e.code === 0);
  });

  it('never runs two tasks of one step at once, and sends the running steps on every poll', async () => {
    fake = await startFakeOrchestrator([
      { id: 'sq_1', slug: 'VM3_01_transcribe_whisper' },
      { id: 'sq_2', slug: 'VM3_01_transcribe_whisper' },
    ]);
    setEnv(fake.url);
    const { state, getHandler } = controllableHandlers(['VM3_01_transcribe_whisper']);
    const { startFactory } = await importFactory();
    const session = startFactory({ getHandler });
    const vm3 = state.VM3_01_transcribe_whisper;

    await until(() => vm3.started.length === 1);
    const polls_before = fake.polls().length;
    await until(() => fake.polls().length >= polls_before + 3);
    assert.equal(vm3.started.length, 1, 'the second task waits');
    assert.equal(fake.queue.find((s) => s.id === 'sq_2').status, 'pending');
    assert.ok(fake.polls().slice(polls_before).every((p) => p.exclude === 'VM3_01_transcribe_whisper'));

    vm3.gates[0].resolve();
    await until(() => vm3.started.length === 2);
    assert.deepEqual(vm3.started, ['sq_1', 'sq_2']);
    vm3.gates[1].resolve();
    await until(() => fake.queue.every((s) => s.status === 'completed'));
    assert.equal(vm3.max_running, 1);

    fake.closeSession();
    await assert.rejects(session, (e) => e instanceof Exit && e.code === 0);
  });

  it('sends no exclusions while nothing runs', async () => {
    fake = await startFakeOrchestrator([]);
    setEnv(fake.url);
    const { startFactory } = await importFactory();
    const session = startFactory({ getHandler: () => null });

    await until(() => fake.polls().length >= 2);
    assert.ok(fake.polls().every((p) => p.exclude === null));

    fake.closeSession();
    await assert.rejects(session, (e) => e instanceof Exit && e.code === 0);
  });

  it('frees a step for the next task after it fails', async () => {
    fake = await startFakeOrchestrator([
      { id: 'sq_1', slug: 'Y1_01_capture_video' },
      { id: 'sq_2', slug: 'Y1_01_capture_video' },
    ]);
    setEnv(fake.url);
    let calls = 0;
    const getHandler = () => async () => {
      calls++;
      if (calls === 1) throw new Error('yt-dlp failed');
      return { ok: true };
    };
    const { startFactory } = await importFactory();
    const session = startFactory({ getHandler });

    await until(() => fake.queue.find((s) => s.id === 'sq_2').status === 'completed');
    assert.equal(fake.queue.find((s) => s.id === 'sq_1').status, 'failed');
    const failed = fake.requests.find((r) => r.path === '/api/factory/failed');
    assert.deepEqual(failed.body, { step_queue_id: 'sq_1', error: 'yt-dlp failed', retryable: true });

    fake.closeSession();
    await assert.rejects(session, (e) => e instanceof Exit && e.code === 0);
  });
});

describe('startFactory — stopping', () => {
  it('on SIGINT stops polling, disconnects and exits while a task runs', async () => {
    fake = await startFakeOrchestrator([{ id: 'sq_upload', slug: 'AR2_01_move_to_b2' }]);
    setEnv(fake.url);
    const { state, getHandler } = controllableHandlers(['AR2_01_move_to_b2']);
    const exited = deferred();
    mockMethod(process, 'exit', () => { exited.resolve(); });
    const { startFactory } = await importFactory();
    void startFactory({ getHandler });

    await until(() => state.AR2_01_move_to_b2.started.length === 1);
    process.emit('SIGINT');
    await exited.promise;

    const polls_at_exit = fake.polls().length;
    const disconnects = fake.requests.filter((r) => r.path === '/api/factory/disconnect');
    assert.equal(disconnects.length, 1);
    // The disconnect comes after every poll, so no claim lands after it.
    assert.equal(fake.requests.at(-1).path, '/api/factory/disconnect');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(fake.polls().length, polls_at_exit, 'no poll after shutdown');
  });

  it('does not report a step that fails during shutdown, so no retry is spent', async () => {
    fake = await startFakeOrchestrator([{ id: 'sq_upload', slug: 'AR2_01_move_to_b2' }]);
    setEnv(fake.url);
    const killed = deferred();
    // Like rclone killed by the SIGINT that pm2 sends to the whole process tree.
    const getHandler = () => async () => { await killed.promise; throw new Error('rclone_failed: (no output)'); };
    const exited = deferred();
    mockMethod(process, 'exit', () => { exited.resolve(); });
    const { startFactory } = await importFactory();
    void startFactory({ getHandler });

    await until(() => fake.queue[0].status === 'claimed');
    process.emit('SIGINT');
    killed.resolve();
    await exited.promise;
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(fake.requests.filter((r) => r.path === '/api/factory/failed').length, 0);
    assert.equal(fake.requests.filter((r) => r.path === '/api/factory/disconnect').length, 1);
  });

  it('disconnects before exiting when the orchestrator closed the session', async () => {
    fake = await startFakeOrchestrator([{ id: 'sq_upload', slug: 'AR2_01_move_to_b2' }]);
    setEnv(fake.url);
    const { state, getHandler } = controllableHandlers(['AR2_01_move_to_b2']);
    const { startFactory } = await importFactory();
    const session = startFactory({ getHandler });

    await until(() => state.AR2_01_move_to_b2.started.length === 1);
    fake.closeSession();
    await assert.rejects(session, (e) => e instanceof Exit && e.code === 0);

    assert.equal(fake.requests.at(-1).path, '/api/factory/disconnect');
  });
});
