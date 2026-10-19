import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { resolveWatchedStations, resolveIntakeWatchedStations, findUntriggeredStations } = await import(
  '../../src/utils/watched-stations.js'
);

let tmp_dir;
let original_cwd;
let original_location;

/**
 * @param {string} filename
 * @param {object} config
 */
function writeStationFile(filename, config) {
  const dir = path.join(tmp_dir, '.orchestrator', 'stations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(config));
}

/**
 * @param {string} code
 * @param {string} location
 */
function writeLineFile(code, location) {
  const dir = path.join(tmp_dir, '.orchestrator', 'lines');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${code}.json`), JSON.stringify({ code, name: code, location }));
}

/** The lines every test starts from: two at this factory session's location, one elsewhere. */
function writeDefaultLines() {
  writeLineFile('CAR', 'alex-laptop1');
  writeLineFile('AV', 'alex-laptop1');
  writeLineFile('M', 'alex-laptop1');
  writeLineFile('BK-SR', 'alex-laptop1');
  writeLineFile('VM', 'alex-laptop');
}

describe('resolveWatchedStations', () => {
  beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watched-stations-'));
    original_cwd = process.cwd();
    original_location = process.env.FACTORY_LOCATION;
    process.chdir(tmp_dir);
    process.env.FACTORY_LOCATION = 'alex-laptop1';
    writeDefaultLines();
  });

  afterEach(() => {
    process.chdir(original_cwd);
    if (original_location === undefined) delete process.env.FACTORY_LOCATION;
    else process.env.FACTORY_LOCATION = original_location;
    fs.rmSync(tmp_dir, { recursive: true, force: true });
  });

  it('derives source_station/source_bin for a watch_enabled station at this location', async () => {
    writeStationFile('CAR1__capture_listing.json', {
      id: 'maaopXWtoU7I',
      short_code: 'CAR1',
      line: 'CAR',
      watch_enabled: true,
      steps: [
        { slug: 'lib-factory:move_files', config: { source_bin: 'CAR0/output' } },
        { slug: 'CAR1_01_capture_listing', config: {} },
      ],
    });

    const watched = await resolveWatchedStations();

    assert.deepEqual(watched, [
      { station: 'CAR1', station_id: 'maaopXWtoU7I', source_station: 'CAR0', source_bin: 'output' },
    ]);
  });

  it('skips stations with watch_enabled false or unset', async () => {
    writeStationFile('AV1__verify_balance.json', {
      id: 'av1id',
      short_code: 'AV1',
      line: 'AV',
      watch_enabled: false,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'AV0/output' } }],
    });
    writeStationFile('M0__discover_urls.json', {
      id: 'm0id',
      short_code: 'M0',
      line: 'M',
      steps: [{ slug: 'M0_01_discover_urls', config: {} }],
    });

    const watched = await resolveWatchedStations();

    assert.deepEqual(watched, []);
  });

  it('skips watch_enabled stations whose line is at a different location', async () => {
    writeStationFile('VM2__extract_apple_transcript.json', {
      id: 'vm2id',
      short_code: 'VM2',
      line: 'VM',
      watch_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'VM0/output' } }],
    });

    const watched = await resolveWatchedStations();

    assert.deepEqual(watched, []);
  });

  it('preserves a nested bin path (e.g. a human-approval-gated conveyor)', async () => {
    writeStationFile('BK-SR2__apply_approved_period.json', {
      id: 'I7ikKYcDo7XH',
      short_code: 'BK-SR2',
      line: 'BK-SR',
      watch_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'BK-SR1/output/approved' } }],
    });

    const watched = await resolveWatchedStations();

    assert.deepEqual(watched, [
      { station: 'BK-SR2', station_id: 'I7ikKYcDo7XH', source_station: 'BK-SR1', source_bin: 'output/approved' },
    ]);
  });

  it('throws when a watch_enabled station has no id (not pushed live yet)', async () => {
    writeStationFile('CAR1__capture_listing.json', {
      short_code: 'CAR1',
      line: 'CAR',
      watch_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'CAR0/output' } }],
    });

    await assert.rejects(() => resolveWatchedStations(), /has no id — push it live first/);
  });

  it('throws when .orchestrator/lines/ is missing — the repo has not been pulled since lines became an object', async () => {
    fs.rmSync(path.join(tmp_dir, '.orchestrator', 'lines'), { recursive: true, force: true });
    writeStationFile('CAR1__capture_listing.json', {
      id: 'maaopXWtoU7I',
      short_code: 'CAR1',
      line: 'CAR',
      watch_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'CAR0/output' } }],
    });

    await assert.rejects(() => resolveWatchedStations(), /lines pull --all/);
  });

  it('throws when a station has no line', async () => {
    writeStationFile('CAR1__capture_listing.json', {
      id: 'maaopXWtoU7I',
      short_code: 'CAR1',
      watch_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'CAR0/output' } }],
    });

    await assert.rejects(() => resolveWatchedStations(), /has no line/);
  });

  it('skips a station whose line has no local line file (not served here)', async () => {
    writeStationFile('ZZ1__unknown.json', {
      id: 'zz1id',
      short_code: 'ZZ1',
      line: 'ZZ',
      watch_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'ZZ0/output' } }],
    });

    assert.deepEqual(await resolveWatchedStations(), []);
  });

  it('throws when a watch_enabled station has neither a move_files step0 nor a watch_path', async () => {
    writeStationFile('CAR1__capture_listing.json', {
      id: 'maaopXWtoU7I',
      short_code: 'CAR1',
      line: 'CAR',
      watch_enabled: true,
      steps: [{ slug: 'CAR1_01_capture_listing', config: {} }],
    });

    await assert.rejects(
      () => resolveWatchedStations(),
      /neither a move_files step0 with source_bin nor a step0 watch_path/,
    );
  });

  it('leaves a watch_enabled line-head with a watch_path to the intake watcher', async () => {
    writeStationFile('CAR0__discover_urls.json', {
      id: 'car0id',
      short_code: 'CAR0',
      line: 'CAR',
      watch_enabled: true,
      steps: [{ slug: 'CAR0_01_discover_urls', config: { watch_path: '/inbox/inbox.txt' } }],
    });

    assert.deepEqual(await resolveWatchedStations(), []);
  });
});

describe('resolveIntakeWatchedStations', () => {
  beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watched-stations-'));
    original_cwd = process.cwd();
    original_location = process.env.FACTORY_LOCATION;
    process.chdir(tmp_dir);
    process.env.FACTORY_LOCATION = 'alex-laptop1';
    writeDefaultLines();
  });

  afterEach(() => {
    process.chdir(original_cwd);
    if (original_location === undefined) delete process.env.FACTORY_LOCATION;
    else process.env.FACTORY_LOCATION = original_location;
    fs.rmSync(tmp_dir, { recursive: true, force: true });
  });

  it('returns a watch_enabled line-head with its absolute watch_path', async () => {
    writeStationFile('CAR0__discover_urls.json', {
      id: 'car0id',
      short_code: 'CAR0',
      line: 'CAR',
      watch_enabled: true,
      steps: [{ slug: 'CAR0_01_discover_urls', config: { watch_path: '/Users/alex/carwale-archive/inbox.txt' } }],
    });

    assert.deepEqual(await resolveIntakeWatchedStations(), [
      { station: 'CAR0', station_id: 'car0id', watch_path: '/Users/alex/carwale-archive/inbox.txt' },
    ]);
  });

  it('resolves a relative watch_path against the factory root', async () => {
    writeStationFile('M0__discover_urls.json', {
      id: 'm0id',
      short_code: 'M0',
      line: 'M',
      watch_enabled: true,
      steps: [{ slug: 'M0_01_discover_urls', config: { watch_path: 'temp/inbox' } }],
    });

    const [watched] = await resolveIntakeWatchedStations();

    assert.equal(watched.watch_path, path.join(process.cwd(), 'temp/inbox'));
  });

  it('skips conveyors, stations without watch_enabled, and stations at another location', async () => {
    writeStationFile('CAR1__capture_listing.json', {
      id: 'car1id',
      short_code: 'CAR1',
      line: 'CAR',
      watch_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'CAR0/output' } }],
    });
    writeStationFile('M0__discover_urls.json', {
      id: 'm0id',
      short_code: 'M0',
      line: 'M',
      schedule_enabled: true,
      steps: [{ slug: 'M0_01_discover_urls', config: { watch_path: '/inbox.txt' } }],
    });
    writeStationFile('VM0__discover.json', {
      id: 'vm0id',
      short_code: 'VM0',
      line: 'VM',
      watch_enabled: true,
      steps: [{ slug: 'VM0_01_discover', config: { watch_path: '/memos' } }],
    });

    assert.deepEqual(await resolveIntakeWatchedStations(), []);
  });

  it('throws when a watched line-head has no id (not pushed live yet)', async () => {
    writeStationFile('CAR0__discover_urls.json', {
      short_code: 'CAR0',
      line: 'CAR',
      watch_enabled: true,
      steps: [{ slug: 'CAR0_01_discover_urls', config: { watch_path: '/inbox.txt' } }],
    });

    await assert.rejects(() => resolveIntakeWatchedStations(), /has no id — push it live first/);
  });
});

describe('findUntriggeredStations', () => {
  beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watched-stations-'));
    original_cwd = process.cwd();
    original_location = process.env.FACTORY_LOCATION;
    process.chdir(tmp_dir);
    process.env.FACTORY_LOCATION = 'alex-laptop1';
    writeDefaultLines();
  });

  afterEach(() => {
    process.chdir(original_cwd);
    if (original_location === undefined) delete process.env.FACTORY_LOCATION;
    else process.env.FACTORY_LOCATION = original_location;
    fs.rmSync(tmp_dir, { recursive: true, force: true });
  });

  it('flags a conveyor station with neither schedule_enabled nor watch_enabled', async () => {
    writeStationFile('BK-SR1__check_and_propose.json', {
      id: 'bksr1id',
      short_code: 'BK-SR1',
      line: 'BK-SR',
      is_enabled: true,
      schedule_enabled: false,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'BK-SR0/output' } }],
    });

    const unwatched = await findUntriggeredStations();

    assert.deepEqual(unwatched, ['BK-SR1']);
  });

  it('does not flag a station with schedule_enabled true', async () => {
    writeStationFile('M1__capture_audio.json', {
      id: 'm1id',
      short_code: 'M1',
      line: 'M',
      schedule_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'M0/output' } }],
    });

    assert.deepEqual(await findUntriggeredStations(), []);
  });

  it('does not flag a station with watch_enabled true', async () => {
    writeStationFile('CAR1__capture_listing.json', {
      id: 'car1id',
      short_code: 'CAR1',
      line: 'CAR',
      schedule_enabled: false,
      watch_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'CAR0/output' } }],
    });

    assert.deepEqual(await findUntriggeredStations(), []);
  });

  it('flags a line-head that feeds a conveyor and has neither trigger', async () => {
    writeStationFile('CAR0__discover_urls.json', {
      id: 'car0id',
      short_code: 'CAR0',
      line: 'CAR',
      schedule_enabled: false,
      steps: [{ slug: 'CAR0_01_discover_urls', config: {} }],
    });
    writeStationFile('CAR1__capture_listing.json', {
      id: 'car1id',
      short_code: 'CAR1',
      line: 'CAR',
      watch_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'CAR0/output' } }],
    });

    assert.deepEqual(await findUntriggeredStations(), ['CAR0']);
  });

  it('finds the line-head through a moves array too', async () => {
    writeStationFile('M0__discover_urls.json', {
      id: 'm0id',
      short_code: 'M0',
      line: 'M',
      steps: [{ slug: 'M0_01_discover_urls', config: {} }],
    });
    writeStationFile('M1__capture_audio.json', {
      id: 'm1id',
      short_code: 'M1',
      line: 'M',
      schedule_enabled: true,
      steps: [{ slug: 'lib-factory:move_files', config: { moves: [{ source_bin: 'M0/output', target_bin: 'M1/input' }] } }],
    });

    assert.deepEqual(await findUntriggeredStations(), ['M0']);
  });

  it('does not flag a standalone station that feeds no conveyor', async () => {
    writeStationFile('AV0__verify.json', {
      id: 'av0id',
      short_code: 'AV0',
      line: 'AV',
      schedule_enabled: false,
      steps: [{ slug: 'AV0_01_verify', config: {} }],
    });

    assert.deepEqual(await findUntriggeredStations(), []);
  });

  it('does not flag a line-head with a cron (no move_files step0)', async () => {
    writeStationFile('CAR0__discover_urls.json', {
      id: 'car0id',
      short_code: 'CAR0',
      line: 'CAR',
      schedule_enabled: true,
      steps: [{ slug: 'CAR0_01_discover_urls', config: {} }],
    });

    assert.deepEqual(await findUntriggeredStations(), []);
  });

  it('does not flag a station that is explicitly disabled or archived', async () => {
    writeStationFile('AV1__verify_balance.json', {
      id: 'av1id',
      short_code: 'AV1',
      line: 'AV',
      is_enabled: false,
      schedule_enabled: false,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'AV0/output' } }],
    });
    writeStationFile('SV1__fetch_and_check.json', {
      id: 'sv1id',
      short_code: 'SV1',
      line: 'SV',
      archived_at: '2026-01-01T00:00:00.000Z',
      schedule_enabled: false,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'SV0/output' } }],
    });

    assert.deepEqual(await findUntriggeredStations(), []);
  });

  it('ignores stations at a different location', async () => {
    writeStationFile('VM2__extract_apple_transcript.json', {
      id: 'vm2id',
      short_code: 'VM2',
      line: 'VM',
      schedule_enabled: false,
      steps: [{ slug: 'lib-factory:move_files', config: { source_bin: 'VM0/output' } }],
    });

    assert.deepEqual(await findUntriggeredStations(), []);
  });
});
