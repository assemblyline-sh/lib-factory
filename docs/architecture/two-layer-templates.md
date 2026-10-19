# Two-Layer Templates

Template resolution checks factory repo first, then falls back to lib-factory.

## Resolution Order

1. `{factory}/src/templates/{path}.md` - Factory-specific templates
2. `{lib-factory}/src/templates/{path}.md` - Shared templates

## Setup

Requires `callerUrl` in startFactory:

```javascript
startFactory({
  getHandler,
  callerUrl: import.meta.url  // Enables factory template resolution
});
```

## Usage

```javascript
import { renderTemplate } from '@assemblyline/lib-factory';

const content = await renderTemplate('check_invoice/summary', data);
```

## Override Pattern

Factory can override lib templates by creating same path:
- Lib: `lib-factory/src/templates/reports/balance.md`
- Factory: `factory/src/templates/reports/balance.md` (takes precedence)

## Related Notes

- [template-helpers.md](/docs/architecture/template-helpers.md)
- [start-factory.md](/docs/architecture/start-factory.md)
