# Polling Loop

The loop that claims tasks from the orchestrator and runs them. Tasks of different steps
run side by side; a step never runs two tasks at once.

## Flow

1. GET `/api/factory/poll` with auth headers and the slugs of the steps running now
2. If a task comes back, start its handler without waiting for it, and note its step as running
3. Wait `POLL_INTERVAL_MS` (default 2000ms), then poll again
4. When a handler finishes, report success or failure, and the step is free again

A long step (a multi-GB upload) holds only its own step. Other stations keep claiming and
running their steps, and the session keeps polling, so it never goes quiet long enough to
expire.

## One task per step

Two tasks of one station's step would pick up the same workpieces from its input bin. So
each poll sends `X-Exclude-Steps` with the slugs running now, and the orchestrator doesn't
hand out another task of those steps. The key is the step slug, so stations that share a
slug (every conveyor uses `lib-factory:move_files`) take turns.

Steps share one Node process. A step that does long synchronous work (`execFileSync`, a
`readdirSync` walk) holds up the other steps while it runs; one that awaits does not.

## Poll Request Headers

```
api-key: {ORCHESTRATOR_API_KEY}
api-secret: {ORCHESTRATOR_API_SECRET}
X-Location: {FACTORY_LOCATION}
X-Factory-User-Agent: {user agent}
X-Factory-Session: {session id, after the first poll}
X-Exclude-Steps: {slug,slug — only while steps run}
```

## After Execution

- Success: POST `/api/factory/complete` with `{ step_queue_id, output }`
- Failure: POST `/api/factory/failed` with `{ step_queue_id, error, retryable }`

## Related Notes

- [task-structure.md](/docs/architecture/task-structure.md)
- [handler-resolution.md](/docs/architecture/handler-resolution.md)
- [graceful-shutdown.md](/docs/architecture/graceful-shutdown.md)
