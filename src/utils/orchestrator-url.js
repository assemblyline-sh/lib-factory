// @ts-check

/** The hosted Orchestrator; al-orc defaults to the same URL. */
export const DEFAULT_ORCHESTRATOR_URL = 'https://orchestrator.assemblyline.sh';

/**
 * The Orchestrator this factory session talks to: `ORCHESTRATOR_URL`, else the hosted one.
 * @returns {string}
 */
export function orchestratorUrl() {
  return process.env.ORCHESTRATOR_URL || DEFAULT_ORCHESTRATOR_URL;
}
