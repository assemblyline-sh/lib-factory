# Graceful Shutdown

A factory session registers handlers for `SIGTERM` and `SIGINT` (pm2 sends `SIGINT` on
restart).

## Behavior

1. POST `/api/factory/disconnect`, which frees the location for the next session
2. Exits. Tasks still running stop with the process

The next session empties every `doing/` bin at boot, so a workpiece whose step was cut
off is redone from `input/` by the station's next run. The step itself stays `claimed` on
the orchestrator until its run times out (240 minutes), and the station gets no new runs
until then.

## Why It Matters

- The location is free for the restarted session immediately, not after the 5-minute expiry

## Related Notes

- [polling-loop.md](/docs/architecture/polling-loop.md)
- [start-factory.md](/docs/architecture/start-factory.md)
