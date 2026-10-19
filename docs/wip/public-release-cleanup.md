# Public release cleanup

## Status: NOT STARTED

Make `assemblyline-sh/lib-factory` public. The customer names are gone and the history
starts fresh at 0.1.0 (the earlier history is in the private `lib-factory-archive`); what's
left is a pass over every file for FinOpsBricks-specific content that a public reader
shouldn't see or wouldn't understand.

---

## Problem Statement

The repo is a fork of `@fob/lib-worker`. Its code is generic, but its docs and changelog
still carry FinOpsBricks context: references to FinOpsBricks apps and repos, relative links
into the FinOpsBricks workspace, finance examples, and lib-worker release notes that name
internal factories and lines. The skill `migrate-worker-to-factory` in the public
`assemblyline-sh/skills` repo installs this package from GitHub, so outside users need
access to it.

## Implementation Phases

### Phase 1: Customer names and fresh history ✅
- [x] Customer names replaced with fictional ones (acme, globex, hooli, initech, umbrella)
      in the changelog and three WIPs
- [x] Old history moved to the private `assemblyline-sh/lib-factory-archive`; new repo with
      one commit, `v0.1.0` re-tagged; factory-template and factory-alex re-locked

### Phase 2: Review every file ❌
- [ ] `grep -rniE "finopsbricks|\bfob\b|@fob|worker|statement|invoice|bank|\.\./\.\./"` and
      go through each hit
- [ ] CHANGELOG: entries before 0.1.0 are lib-worker history. Keep a one-line pointer
      ("forked from @fob/lib-worker 0.35.0") and drop or condense the rest, or rewrite
      them without internal names and paths
- [ ] Links into `../../apps/...` or other workspace paths: replace with public URLs or
      remove
- [ ] `docs/`: keep what describes this package; drop or rewrite notes that describe
      FinOpsBricks apps
- [ ] `docs/wip/`: decide per file (`ai-sdk-adoption`, `config-based-step-discovery`,
      `multi-step-workpiece`) whether it is still a plan for this package; remove the rest
- [ ] JSDoc examples and test fixtures: generic examples, no finance-specific data
- [ ] README: canonical name, one sentence, install, one example, links (marketing
      standard: github-repo-metadata)

### Phase 3: Publish ❌
- [ ] `gitleaks git .` clean; final grep for names, hosts and ids
- [ ] Topics on GitHub (5–15)
- [ ] `gh repo edit assemblyline-sh/lib-factory --visibility public --accept-visibility-change-consequences`
- [ ] Check a fresh `npm install github:assemblyline-sh/lib-factory#v0.1.0` works without
      credentials

## Related Files

- `CHANGELOG.md`, `README.md`, `docs/`
- `assemblyline-sh/skills` → `skills/migrate-worker-to-factory/` (installs this package)
