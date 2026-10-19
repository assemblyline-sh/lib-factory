# Handler Resolution

The `getHandler` function maps step slugs to handler functions. Provided by the consuming factory repo.

```javascript
// src/steps/index.js in factory repo
export function getHandler(slug) {
  const handlers = {
    'fetch_invoice': fetchInvoice,
    'check_invoice': checkInvoice,
    'reconcile': reconcile,
  };
  return handlers[slug] || null;
}
```

## Handler Signature

```javascript
async function handler(task) {
  // task contains: step_queue_id, step, work_record, org_id
  // step contains: slug, config
  // work_record contains: id, item_snapshot, step_outputs
  // ... do work ...
  return { result: 'data' };  // becomes task output
}
```

## Error Handling

Throw an error to fail the task. Set `error.retryable = false` for permanent failures.

```javascript
const error = new Error('Invalid data');
error.retryable = false;
throw error;
```

## Related Notes

- [task-structure.md](/docs/architecture/task-structure.md)
- [polling-loop.md](/docs/architecture/polling-loop.md)
