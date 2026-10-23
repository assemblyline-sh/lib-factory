// @ts-check
import http from 'node:http';

/**
 * A fake orchestrator over real HTTP for startFactory tests. It claims like the real
 * poll route: oldest pending step first, skipping slugs in X-Exclude-Steps.
 */

export class Exit extends Error {
  /** @param {number} code */
  constructor(code) { super(`exit ${code}`); this.code = code; }
}

/** @returns {{ promise: Promise<void>, resolve: () => void }} */
export function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

export const until = async (/** @type {() => boolean} */ check, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
};

/**
 * @param {Array<{ id: string, slug: string }>} steps - pending steps, oldest first
 */
export function startFakeOrchestrator(steps) {
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

/**
 * Handlers that record when they start and finish, and finish when the test says so.
 * @param {string[]} slugs
 */
export function controllableHandlers(slugs) {
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

