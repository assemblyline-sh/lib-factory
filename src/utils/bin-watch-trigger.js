/**
 * Trigger helpers for bin-watch station triggering.
 *
 * Built on the orchestratorGet/orchestratorPost primitives; runs go through
 * /api/v1/stations/:id/run.
 */

import { orchestratorGet, orchestratorPost } from '../orchestrator.js';

const IN_FLIGHT_STATUSES = ['pending', 'running'];

/**
 * True when the given station already has a pending or running work record —
 * mirrors the same overlap-protection check the orchestrator's own cron
 * scheduler (checkScheduledStations.js) performs before queuing a new run,
 * so a bin-watch-triggered run gets the same guard cron gets for free.
 *
 * Must be called with the station's actual database id, not its short_code:
 * /api/v1/work-records?station= does an exact match and does NOT resolve
 * short_codes the way /api/v1/stations/:id/run does.
 *
 * @param {string} station_id
 * @returns {Promise<boolean>}
 */
export async function hasInFlightRun(station_id) {
  for (const status of IN_FLIGHT_STATUSES) {
    const query = new URLSearchParams({ station: station_id, status, limit: '1' });
    const result = await orchestratorGet(`/api/v1/work-records?${query}`);
    if ((result.data ?? []).length > 0) return true;
  }
  return false;
}

/**
 * Trigger a station run — same effect as `al-orc stations run <STATION>`.
 * Caller is responsible for checking `hasInFlightRun` first; this makes no
 * attempt at dedup on its own (the orchestrator's /run endpoint queues a
 * new work record on every call).
 *
 * @param {string} station_id
 * @returns {Promise<{ work_record_id: string, job_id: string }>}
 */
export async function triggerStationRun(station_id) {
  const result = await orchestratorPost(`/api/v1/stations/${station_id}/run`, {});
  return result.data ?? result;
}
