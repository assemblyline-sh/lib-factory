# attachReport

Attaches the final markdown report to a work record.

```javascript
import { attachReport } from '@assemblyline/lib-factory';

await attachReport(
  work_record_id,  // Target work record
  content          // Final report markdown
);
```

## Behavior

1. Writes locally to `temp/{work_record_id}/report.md`
2. POSTs to `/api/factory/attach-report`
3. Returns boolean success status

## Difference from attachDocument

- `attachDocument` - Multiple supporting documents per task
- `attachReport` - Single final report per work record

## Related Notes

- [attach-document.md](/docs/architecture/attach-document.md)
- [temp-file-storage.md](/docs/architecture/temp-file-storage.md)
