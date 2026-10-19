/**
 * Bin-watch station triggering: replaces blind cron polling for downstream
 * conveyor stations with a factory-local loop that triggers a run only when
 * there's actual work — either the station's own `input` bin already has a
 * backlog, or its upstream station's bin has something new to pull in.
 *
 * Runs concurrently with startFactory()'s own poll loop — both are
 * cooperative async loops in the same process; startBinWatcher() resolves
 * quickly (after one pass over the station files) and returns, it doesn't block.
 */

import { bin } from './factoryPaths.js';
import { listWorkpieces } from './files.js';
import { resolveWatchedStations, findUntriggeredStations } from './utils/watched-stations.js';
import { startIntakeWatcher } from './intake-watcher.js';
import { hasInFlightRun, triggerStationRun } from './utils/bin-watch-trigger.js';

const DEFAULT_INTERVAL_MS = 10_000;

/**
 * True when the given station's bin has at least one workpiece in it — the
 * same test the `move_files` conveyor uses to pick what it moves (see
 * files.js's listWorkpieces), so the watcher never triggers a run on
 * something the conveyor would leave behind.
 *
 * @param {string} station
 * @param {string} binName
 * @returns {Promise<boolean>}
 */
export async function binHasWorkpieces(station, binName) {
  return listWorkpieces(bin(station, binName)).length > 0;
}

/**
 * Check each watched station and trigger a run when it has work and no run
 * is already in flight for that station. "Has work" means either of:
 *
 *   - the station's OWN `input` bin already has unprocessed workpieces —
 *     e.g. left over from a prior run whose move_files step pulled in more
 *     than the processing step's own batch_size got through. Checking only
 *     the upstream bin misses this: once upstream drains, the watcher would
 *     otherwise never fire again even with a real backlog sitting in the
 *     station's own input.
 *   - its upstream station's bin (`source_station`/`source_bin`) is
 *     non-empty, meaning a run's move_files step0 would pull in new work.
 *
 * Errors on one station never block the rest — logged and skipped.
 *
 * @param {import('./utils/watched-stations.js').WatchedStation[]} watched
 */
export async function checkAndTrigger(watched) {
  for (const { station, station_id, source_station, source_bin } of watched) {
    try {
      const has_own_backlog = await binHasWorkpieces(station, 'input');
      const has_upstream_work = has_own_backlog ? false : await binHasWorkpieces(source_station, source_bin);
      if (!has_own_backlog && !has_upstream_work) continue;

      // Must check/trigger by station_id, not the short_code in `station` —
      // see the WatchedStation typedef in watched-stations.js for why.
      if (await hasInFlightRun(station_id)) continue;

      const { work_record_id } = await triggerStationRun(station_id);
      console.log(`[bin-watcher] triggered ${station} (work_record_id=${work_record_id})`);
    } catch (err) {
      console.error(`[bin-watcher] ${station}: ${err.message}`);
    }
  }
}

/**
 * Start the bin-watch loop: resolves the watch-list once, then re-checks it
 * on an interval. Also starts the intake watcher (intake-watcher.js) for
 * watch_enabled line-heads, so a factory's entry point needs only this one
 * call. Warns once at startup about any conveyor, or line-head feeding one,
 * that's neither cron'd nor watch_enabled — see findUntriggeredStations().
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs]
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startBinWatcher(opts = {}) {
  const interval_ms = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const watched = await resolveWatchedStations();

  const untriggered = await findUntriggeredStations();
  if (untriggered.length > 0) {
    console.warn(
      `[bin-watcher] ${untriggered.length} station(s) have neither schedule_enabled nor watch_enabled — nothing triggers them: ${untriggered.join(', ')}`,
    );
  }

  const intake = await startIntakeWatcher({ intervalMs: interval_ms });

  const timer = setInterval(() => {
    checkAndTrigger(watched).catch(err => {
      console.error(`[bin-watcher] tick failed: ${err.message}`);
    });
  }, interval_ms);
  timer.unref();

  return {
    stop: () => {
      clearInterval(timer);
      intake.stop();
    },
  };
}
