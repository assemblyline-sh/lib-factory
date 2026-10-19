# Graceful Shutdown

A factory session registers handlers for `SIGTERM` and `SIGINT` signals.

## Behavior

1. Sets flag to stop polling loop
2. Waits for current task to complete (if any)
3. Exits cleanly

## Why It Matters

- Prevents task abandonment during deploys
- Allows in-flight work to complete
- Orchestrator won't see task as timed out

## Related Notes

- [polling-loop.md](/docs/architecture/polling-loop.md)
- [start-factory.md](/docs/architecture/start-factory.md)
