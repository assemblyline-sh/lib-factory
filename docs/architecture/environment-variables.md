# Environment Variables

Uses `process.env` directly. No config abstraction. Missing required vars cause immediate exit.

## Required

| Variable | Purpose |
|----------|---------|
| `ORCHESTRATOR_API_KEY` | Per-org API key for orchestrator auth |
| `ORCHESTRATOR_API_SECRET` | Per-org API secret for orchestrator auth |
| `FACTORY_LOCATION` | Where this factory session runs; matched against each line's `location` (e.g., `office-mac`, `cloud-1`) |

## Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `ORCHESTRATOR_URL` | https://orchestrator.assemblyline.sh | Orchestrator base URL |
| `POLL_INTERVAL_MS` | 2000 | Polling interval |
| `NODE_ENV` | - | If 'development', skips temp cleanup |

## Related Notes

- [start-factory.md](/docs/architecture/start-factory.md)
