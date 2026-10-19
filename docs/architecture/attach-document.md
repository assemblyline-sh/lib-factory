# attachDocument

Attaches supporting documents to work records during task execution.

```javascript
import { attachDocument } from '@assemblyline/lib-factory';

await attachDocument(
  work_record_id,  // Target work record
  title,           // Document title (e.g., 'Balance Check')
  content,         // Markdown content
  step_slug        // Step slug for file naming (e.g., 'verify_data')
);
```

## Usage in Step Handler

```javascript
export default async function verifyData(task) {
  const { step, work_record } = task;

  // ... do verification ...

  await attachDocument(work_record.id, 'Verification Results', content, step.slug);

  return { verified: true };
}
```

## Behavior

1. Writes locally to `temp/{work_record_id}/{step_slug}_{title}.md`
2. POSTs to `/api/factory/attach-document`
3. Returns boolean success status

## File Naming

Title is sanitized: spaces become underscores, special chars removed.

Example: `temp/wr_123/verify_data_Balance_Check.md`

## Related Notes

- [attach-report.md](/docs/architecture/attach-report.md)
- [temp-file-storage.md](/docs/architecture/temp-file-storage.md)
- [task-structure.md](/docs/architecture/task-structure.md)
