# Temp File Storage

Documents are written locally before upload to orchestrator.

## Structure

```
temp/
└── {work_record_id}/
    ├── 1_Fetch_Invoice.md
    ├── 2_Balance_Check.md
    └── report.md
```

## Cleanup

`clearTemp(work_record_id)` removes the directory after processing.

```javascript
import { clearTemp } from '@assemblyline/lib-factory';

await clearTemp(work_record_id);
```

**Development mode** (`NODE_ENV=development`): Cleanup is skipped for debugging.

## Why Local Storage

- Enables debugging during development
- Allows inspection of generated documents
- Provides retry capability if upload fails

## Related Notes

- [attach-document.md](/docs/architecture/attach-document.md)
- [attach-report.md](/docs/architecture/attach-report.md)
