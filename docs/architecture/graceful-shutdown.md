# Graceful Shutdown

A factory session registers handlers for `SIGTERM` and `SIGINT` (pm2 sends `SIGINT` on
restart).

## Behavior

1. Stops polling, and waits for a poll in flight (at most 500 ms: pm2 sends `SIGKILL`
   1.6 s after `SIGINT` by default, and the disconnect has to leave before that)
2. POST `/api/factory/disconnect`, which frees the location and puts the tasks still
   running back to `pending`
3. Exits. Tasks still running stop with the process

The next session empties every `doing/` bin at boot, claims the released tasks and redoes
their work from `input/`. The same disconnect runs when the orchestrator closes the session.

## Why It Matters

- A restart doesn't leave runs `running` until the orchestrator's 240-minute timeout, and
  their stations get new runs straight away
- The location is free for the restarted session immediately, not after the 5-minute expiry

A crash (`kill -9`, power loss) sends no disconnect: its tasks stay claimed until the
timeout.

## Related Notes

- [polling-loop.md](/docs/architecture/polling-loop.md)
- [start-factory.md](/docs/architecture/start-factory.md)
