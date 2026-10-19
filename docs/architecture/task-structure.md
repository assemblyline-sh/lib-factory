# Task Structure

Tasks received from the orchestrator contain:

```javascript
{
  step_queue_id: 'sq_123',
  step: {
    slug: 'check_invoice',
    config: { /* step config from process definition */ },
  },
  work_record: {
    id: 'wr_456',
    item_snapshot: { id: 'stmt_789', ... },
    step_outputs: { 'fetch_data': { ... } },
  },
  org_id: 'org_123',
}
```

## Fields

| Field | Purpose |
|-------|---------|
| `step_queue_id` | StepQueue ID for reporting completion |
| `step.slug` | Step slug, maps to handler function (identity only, e.g., 'check_invoice') |
| `step.config` | Step configuration from process definition |
| `work_record.id` | Work record ID for document attachments |
| `work_record.item_snapshot` | Primary entity being processed |
| `work_record.step_outputs` | Outputs from previous steps, keyed by slug |
| `org_id` | Organization ID |

## Related Notes

- [handler-resolution.md](/docs/architecture/handler-resolution.md)
- [attach-document.md](/docs/architecture/attach-document.md)
