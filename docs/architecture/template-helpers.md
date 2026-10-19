# Template Helpers

Built-in helper functions available in all EJS templates.

## Available Helpers

| Helper | Purpose | Example Output |
|--------|---------|----------------|
| `formatDate(d, style)` | Date formatting (`short` or `long`) | `Jan 15, 2024` or `Monday, January 15, 2024` |
| `formatPercent(ratio)` | Percentage, one decimal | `85.5%` |
| `formatNumber(n)` | Number with grouping | `1,234` |

Currency formatting is not built in: pass a formatting function in the template data.

## Usage in Templates

```markdown
# Report for <%= formatDate(date, 'long') %>

| Date | Count |
|------|-------|
<% for (const row of data) { %>
| <%= formatDate(row.date, 'short') %> | <%= formatNumber(row.count) %> |
<% } %>
```

## Related Notes

- [two-layer-templates.md](/docs/architecture/two-layer-templates.md)
