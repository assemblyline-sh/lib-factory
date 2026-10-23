// @ts-check
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * startFactory against a fake orchestrator over real HTTP. The fake claims like the
 * real poll route: oldest pending step first, skipping slugs in X-Exclude-Steps.
 *
 * Each test imports a fresh copy of src/factory.js (query string) because the module
 * keeps session state. process.exit is mocked to throw, which ends startFactory.
 */

class Exit extends Error {
  /** @param {number} code */
  constructor(code) { super(`exit ${code}`); this.code = code; }
}

/** @returns {{ promise: Promise<void>, resolve: () => void }} */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const until = async (/** @type {() => boolean} */ check, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
};

/**
 * @param {Array<{ id: string, slug: string }>} steps - pending steps, oldest first
 */
function startFakeOrchestrator(steps) {
  const queue = steps.map((s) => ({ ...s, status: 'pending' }));
  /** @type {Array<{ path: string, exclude: string|null, body?: any }>} */
  const requests = [];
  let close_session = false;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const exclude = /** @type {string|undefined} */ (req.headers['x-exclude-steps']) ?? null;
      requests.push({ path: req.url || '', exclude, body });
      const send = (/** @type {any} */ obj) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };

      if (req.url === '/api/factory/poll') {
        if (close_session) return send({ task: null, session_id: null, session_closed: true });
        const excluded = exclude ? exclude.split(',') : [];
        const next = queue.find((s) => s.status === 'pending' && !excluded.includes(s.slug));
        if (!next) return send({ task: null, session_id: 'sess_1' });
        next.status = 'claimed';
        return send({
          task: {
            step_queue_id: next.id,
            step: { slug: next.slug, config: {} },
            work_record: { id: `wr_${next.id}`, step_outputs: {} },
            org_id: 'org_a',
          },
          session_id: 'sess_1',
        });
      }
      if (req.url === '/api/factory/complete') {
        queue.find((s) => s.id === body.step_queue_id).status = 'completed';
        return send({ success: true });
      }
      if (req.url === '/api/factory/failed') {
        queue.find((s) => s.id === body.step_queue_id).status = 'failed';
        return send({ success: true });
      }
      if (req.url === '/api/factory/disconnect') return send({ success: true });
      res.writeHead(404); res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        queue,
        requests,
        polls: () => requests.filter((r) => r.path === '/api/factory/poll'),
        closeSession: () => { close_session = true; },
        stop: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

let import_count = 0;
async function importFactory() {
  import_count++;
  return import(`../src/factory.js?instance=${import_count}`);
}

/**
 * Handlers that record when they start and finish, and finish when the test says so.
 * @param {string[]} slugs
 */
function controllableHandlers(slugs) {
  /** @type {Record<string, { started: string[], running: number, max_running: number, gates: ReturnType<typeof deferred>[] }>} */
  const state = {};
  for (const slug of slugs) state[slug] = { started: [], running: 0, max_running: 0, gates: [] };
  const getHandler = (/** @type {string} */ slug) => {
    const s = state[slug];
    if (!s) return null;
    return async (/** @type {any} */ task) => {
      const gate = deferred();
      s.gates.push(gate);
      s.started.push(task.step_queue_id);
      s.running++;
      s.max_running = Math.max(s.max_running, s.running);
      await gate.promise;
      s.running--;
      return { ok: true };
    };
  };
  return { state, getHandler };
}

const ENV_KEYS = ['ORCHESTRATOR_URL', 'ORCHESTRATOR_API_KEY', 'ORCHESTRATOR_API_SECRET', 'FACTORY_LOCATION', 'POLL_INTERVAL_MS'];
let saved_env;
let signal_listeners;
let fake;

beforeEach(() => {
  saved_env = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  signal_listeners = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
  mock.method(process, 'exit', (code) => { throw new Exit(code); });
});

afterEach(async () => {
  mock.restoreAll();
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
  it('on SIGINT disconnects and exits while a task runs', async () => {
    fake = await startFakeOrchestrator([{ id: 'sq_upload', slug: 'AR2_01_move_to_b2' }]);
    setEnv(fake.url);
    const { state, getHandler } = controllableHandlers(['AR2_01_move_to_b2']);
    const exited = deferred();
    const exit_mock = mock.method(process, 'exit', (code) => { exited.resolve(code); });
    const { startFactory } = await importFactory();
    const session = startFactory({ getHandler });

    await until(() => state.AR2_01_move_to_b2.started.length === 1);
    process.emit('SIGINT');
    assert.equal(await exited.promise, 0);
    assert.equal(fake.requests.filter((r) => r.path === '/api/factory/disconnect').length, 1);

    // process.exit is mocked, so the loop is still polling: end it.
    exit_mock.mock.mockImplementation((code) => { throw new Exit(code); });
    fake.closeSession();
    await assert.rejects(session, (e) => e instanceof Exit && e.code === 0);
  });
});
