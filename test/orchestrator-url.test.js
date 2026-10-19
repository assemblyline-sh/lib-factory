// @ts-check
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { orchestratorUrl, DEFAULT_ORCHESTRATOR_URL } from '../src/utils/orchestrator-url.js';
import { validateEnv } from '../src/validate-env.js';

describe('orchestratorUrl', () => {
  const saved = process.env.ORCHESTRATOR_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.ORCHESTRATOR_URL;
    else process.env.ORCHESTRATOR_URL = saved;
  });

  it('defaults to the hosted Orchestrator', () => {
    delete process.env.ORCHESTRATOR_URL;
    assert.equal(orchestratorUrl(), 'https://orchestrator.assemblyline.sh');
    assert.equal(DEFAULT_ORCHESTRATOR_URL, 'https://orchestrator.assemblyline.sh');
  });

  it('uses ORCHESTRATOR_URL when set', () => {
    process.env.ORCHESTRATOR_URL = 'http://localhost:3000';
    assert.equal(orchestratorUrl(), 'http://localhost:3000');
  });
});

describe('validateEnv', () => {
  it('logs the orchestrator URL without throwing when the required vars are set', () => {
    const keys = ['ORCHESTRATOR_API_KEY', 'ORCHESTRATOR_API_SECRET', 'FACTORY_LOCATION'];
    const saved = keys.map((k) => process.env[k]);
    keys.forEach((k) => { process.env[k] = 'x'; });
    try {
      assert.doesNotThrow(() => validateEnv());
    } finally {
      keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
    }
  });
});
