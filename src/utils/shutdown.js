// @ts-check

/**
 * Whether this factory session has begun shutting down (SIGINT/SIGTERM, or the
 * orchestrator closed the session). Set once by startFactory; never cleared, since
 * the process exits right after.
 *
 * Steps still running when it is set are about to die with the process, and the
 * signal that started the shutdown often reaches their child processes first (pm2
 * signals the whole process tree). Their failures are the shutdown, not the work:
 * the orchestrator releases their steps and the next session redoes them.
 */
let is_shutting_down = false;

export function markShuttingDown() {
  is_shutting_down = true;
}

/** @returns {boolean} */
export function isShuttingDown() {
  return is_shutting_down;
}
