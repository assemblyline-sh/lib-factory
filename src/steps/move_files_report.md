# Move Files Report

**Timestamp**: <%= timestamp %>

| # | Source | Target | Moved | Available |
|---|--------|--------|------:|----------:|
<% moves_detail.forEach((m, i) => { -%>
| <%= i + 1 %> | <%= m.source_bin %> | <%= m.target_bin %> | <%= m.moved_count %> | <%= m.total_available %> |
<% }) -%>

**Total moved**: <%= total_moved %> / <%= total_available %> available
<% moves_detail.forEach((m, i) => { -%>
<% if (m.entries.length > 0) { -%>

## Move <%= i + 1 %>: <%= m.source_bin %> → <%= m.target_bin %>

| Workpiece |
|------|
<% m.entries.forEach(e => { -%>
| `<%= e %>` |
<% }) -%>
<% } -%>
<% }) -%>

---
*Work Record: <%= work_record_id %>*
