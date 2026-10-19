# Package Overview

`@assemblyline/lib-factory` is the runtime for Assembly Line factories. It handles
orchestrator communication, the step framework, bins and workpieces, and document
generation.

## What It Provides

- **Factory session** - Polls the orchestrator for steps, dispatches to handlers, reports results
- **Orchestrator integration** - Attaching documents, reports and workpiece outcomes to work records
- **Template system** - EJS-based markdown document generation
- **Bins and workpieces** - Station bin paths, the doing-bin contract, the conveyor step
- **Watchers** - Bin watcher and intake watcher
- **The `factory` command** - Run and list a factory's steps locally ([local-step-runner.md](/docs/architecture/local-step-runner.md))

## Usage

```javascript
import { startFactory } from '@assemblyline/lib-factory';
import { getHandler } from './steps/index.js';

startFactory({ getHandler, callerUrl: import.meta.url });
```

## Related Notes

- [start-factory.md](/docs/architecture/start-factory.md)
- [environment-variables.md](/docs/architecture/environment-variables.md)
