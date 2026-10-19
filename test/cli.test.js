import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeFixtureFactory, removeFixtureFactory, REPO_ROOT } from './helpers/fixture-factory.js';

const BIN = path.join(REPO_ROOT, 'bin', 'factory.js');
let root;

beforeEach(() => {
  root = makeFixtureFactory();
});

afterEach(() => {
  removeFixtureFactory(root);
});

/**
 * Run `factory <args>` in a directory, with no terminal and no FIXTURE_SUFFIX in the
 * environment (so it can only come from the factory's .env).
 *
 * @param {string[]} args
 * @param {string} [cwd]
 */
function factory(args, cwd = root) {
  const env = { ...process.env, ORCHESTRATOR_URL: 'http://127.0.0.1:9' };
  delete env.FIXTURE_SUFFIX;
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** @param {string} rel */
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

describe('factory --version / --help', () => {
  it('prints the lib-factory version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const { code, stdout } = factory(['--version']);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), pkg.version);
  });

  it('prints usage with --help, and exits 1 with no command', () => {
    assert.match(factory(['--help']).stdout, /factory steps run <slug>/);
    assert.equal(factory([]).code, 1);
  });

  it('rejects an unknown command or option', () => {
    assert.equal(factory(['lines', 'status']).code, 1);
    const { code, stderr } = factory(['steps', 'list', '--bogus']);
    assert.equal(code, 1);
    assert.match(stderr, /Unknown option '--bogus'/);
  });
});

describe('factory steps list', () => {
  it("lists the factory's steps and move_files", () => {
    const { code, stdout } = factory(['steps', 'list']);
    assert.equal(code, 0);
    assert.match(stdout, /A1_01_greet\s+A1__greet\s+A1_01_greet\.js/);
    assert.match(stdout, /B1_01_shout/);
    assert.match(stdout, /lib-factory:move_files/);
    assert.match(stdout, /Total: 3 steps/);
  });

  it('refuses outside a factory repo', () => {
    const { code, stderr } = factory(['steps', 'list'], path.join(root, 'src'));
    assert.equal(code, 1);
    assert.match(stderr, /No src\/steps\//);
  });
});

describe('factory steps run', () => {
  it('runs with a scenario, then chains into a station config that reads .env', () => {
    const first = factory(['steps', 'run', 'A1_01_greet', '--scenario', 'world']);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Config: scenario: world/);
    assert.match(first.stdout, /Output saved: temp\/A1_01_greet\.json/);
    assert.equal(readJson('temp/A1_01_greet.json').greeting, 'Hello, world');

    const second = factory(['steps', 'run', 'B1_01_shout', '--station', 'B1']);
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /Config: station: shout \(B1\)/);
    assert.match(second.stdout, /Step outputs it could read: A1_01_greet/);
    assert.equal(readJson('temp/B1_01_shout.json').shouted, 'HELLO, WORLD!');
  });

  it('writes attachments under temp/work_records and never reaches the orchestrator', () => {
    const { code } = factory(['steps', 'run', 'A1_01_greet', '-s', 'acme']);
    assert.equal(code, 0);
    const { work_record_id } = readJson('temp/A1_01_greet.json');
    assert.match(work_record_id, /^local-wr-/);
    const wr = path.join(root, 'temp', 'work_records', work_record_id);
    assert.deepEqual(fs.readdirSync(wr).sort(), ['Greeting.md', 'report.md', 'workpieces.json']);
  });

  it('runs with --empty', () => {
    const { code, stdout } = factory(['steps', 'run', 'A1_01_greet', '--empty']);
    assert.equal(code, 0);
    assert.match(stdout, /Config: empty/);
    assert.equal(readJson('temp/A1_01_greet.json').greeting, 'Hello, undefined');
  });

  it('exits 1 for an unknown step, station or scenario', () => {
    assert.match(factory(['steps', 'run', 'nope', '--empty']).stderr, /Unknown step: nope/);
    const station = factory(['steps', 'run', 'A1_01_greet', '--station', 'Z9']);
    assert.equal(station.code, 1);
    assert.match(station.stderr, /Station not found locally: Z9\nRun "al-orc stations pull Z9" first/);
    const step = factory(['steps', 'run', 'A1_01_greet', '--station', 'B1']);
    assert.match(step.stderr, /Step "A1_01_greet" not found in station "B1"\nAvailable steps: B1_01_shout/);
    const scenario = factory(['steps', 'run', 'A1_01_greet', '--scenario', 'nope']);
    assert.match(scenario.stderr, /Scenario not found: nope\nAvailable scenarios: acme, world/);
  });

  it('asks for a flag instead of the picker when there is no terminal', () => {
    const { code, stderr } = factory(['steps', 'run', 'A1_01_greet']);
    assert.equal(code, 1);
    assert.match(stderr, /needs a terminal\. Pass --station, --scenario or --empty\./);
  });

  it('exits 1 when the step throws', () => {
    fs.writeFileSync(
      path.join(root, 'src', 'steps', 'A1__greet', 'A1_02_fail.js'),
      "import { defineStep } from '@assemblyline/lib-factory';\n" +
        "export default defineStep({ slug: 'A1_02_fail', name: 'Fail', description: 'Always throws.', execute: async () => { throw new Error('boom'); } });\n",
    );
    const { code, stderr } = factory(['steps', 'run', 'A1_02_fail', '--empty']);
    assert.equal(code, 1);
    assert.match(stderr, /boom/);
    assert.equal(fs.existsSync(path.join(root, 'temp', 'A1_02_fail.json')), false);
  });
});

describe('factory stations update-step-metadata', () => {
  it("copies each step's name and description into station files that run it", () => {
    const { code, stdout } = factory(['stations', 'update-step-metadata']);
    assert.equal(code, 0);
    assert.match(stdout, /Updated: greet \(A1\)/);
    assert.match(stdout, /Updated 1 of 2 stations/);
    const step = readJson('.orchestrator/stations/A1__greet.json').steps[0];
    assert.equal(step.name, 'Greet');
    assert.equal(step.description, 'Greets config.name and attaches a document, a report and a workpiece outcome.');
    assert.deepEqual(step.config, { name: 'station' });
  });

  it('says to pull when there are no station files', () => {
    fs.rmSync(path.join(root, '.orchestrator', 'stations'), { recursive: true });
    const { code, stdout } = factory(['stations', 'update-step-metadata']);
    assert.equal(code, 0);
    assert.match(stdout, /No local stations found\nRun "al-orc stations pull --all" first/);
  });
});
