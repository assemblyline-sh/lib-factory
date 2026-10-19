# Polling Loop

Infinite loop that fetches tasks from the orchestrator and dispatches to handlers.

## Flow

1. GET `/api/factory/poll` with auth headers
2. If no task, wait `POLL_INTERVAL_MS` (default 2000ms)
3. If task received, resolve handler and execute
4. Report success or failure to orchestrator
5. Repeat

## Poll Request Headers

```
api-key: {ORCHESTRATOR_API_KEY}
api-secret: {ORCHESTRATOR_API_SECRET}
X-Location: {FACTORY_LOCATION}
```

## After Execution

- Success: POST `/api/factory/complete` with `{ task_id, output }`
- Failure: POST `/api/factory/failed` with `{ task_id, error, retryable }`

## Related Notes

- [task-structure.md](/docs/architecture/task-structure.md)
- [handler-resolution.md](/docs/architecture/handler-resolution.md)
- [graceful-shutdown.md](/docs/architecture/graceful-shutdown.md)
