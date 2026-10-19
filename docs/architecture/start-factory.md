# startFactory Function

Main entry point that initializes the factory session and starts the polling loop.

```javascript
import { startFactory } from '@assemblyline/lib-factory';

startFactory({
  getHandler,                    // Required: function(step_type) => handler
  callerUrl: import.meta.url     // Required: for template resolution
});
```

## Startup Sequence

1. `validateEnv()` - Checks required environment variables
2. `initTemplates(callerUrl)` - Sets up template directories
3. Registers signal handlers (SIGTERM, SIGINT)
4. Starts polling loop

## Related Notes

- [polling-loop.md](/docs/architecture/polling-loop.md)
- [handler-resolution.md](/docs/architecture/handler-resolution.md)
- [environment-variables.md](/docs/architecture/environment-variables.md)
- [two-layer-templates.md](/docs/architecture/two-layer-templates.md)
