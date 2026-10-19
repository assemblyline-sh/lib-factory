# Bump lib-factory in All Dependent Repos

Update all repos inside `/Users/alex/ec2code/assemblyline/` that depend on `@assemblyline/lib-factory` to the current version of this package.

## Step 1: Get Current Version

Read `package.json` in the current working directory and extract the `version` field. This is the target version.

## Step 2: Find Dependent Repos

Run:
```bash
grep -r "@assemblyline/lib-factory" /Users/alex/ec2code/assemblyline/ --include="package.json" -l 2>/dev/null | grep -v node_modules
```

Exclude:
- The lib-factory package itself (`lib/lib-factory/package.json`)

## Step 3: Show Current State

For each dependent repo found, show the current `@assemblyline/lib-factory` value in their `package.json`. Present a summary table of what will change before proceeding.

Ask the user to confirm before making any changes.

## Step 4: Update Each Repo

For each dependent repo (run in parallel):

1. **Update package.json** — set `@assemblyline/lib-factory` to `"github:assemblyline-sh/lib-factory#v{VERSION}"`

2. **Force re-resolve the lock file** — run:
   ```bash
   npm install @assemblyline/lib-factory@github:assemblyline-sh/lib-factory#v{VERSION}
   ```
   This ensures `package-lock.json` resolves to the correct commit, not a cached one.

3. **Verify** the lock file now contains `"version": "{VERSION}"` for `node_modules/@assemblyline/lib-factory`

## Step 5: Commit and Push Each Repo

For each dependent repo (run in parallel):

```bash
git add package.json package-lock.json
git commit -m "chore: bump @assemblyline/lib-factory to v{VERSION}"
git push
```

## Step 6: Summary

Report results in a table:

| Repo | Previous Version | New Version | Status |
|------|-----------------|-------------|--------|
| ...  | ...             | ...         | pushed / failed |

If any repo failed, report the error clearly.
