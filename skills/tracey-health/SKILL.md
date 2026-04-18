---
description: "Diagnose and repair the Tracey configuration for a spec-driven project. Checks config.styx for missing include patterns, stale archive paths, and duplicate requirement errors. Use when Tracey reports 'No specs configured', duplicate requirements, or when tracey_validate fails."
argument-hint: "[--fix]"
---

# Tracey Health

Diagnose and optionally repair `.config/tracey/config.styx` to ensure Tracey can
correctly index specs for this project.

## Steps

1. **Parse arguments** from `$ARGUMENTS`:
   - Look for `--fix` flag. If present, apply all fixes without prompting.

2. **Check Tracey config exists**:
   ```bash
   test -f .config/tracey/config.styx && echo "EXISTS" || echo "MISSING"
   ```
   If MISSING: say "No Tracey config found at `.config/tracey/config.styx`. Run `/spec-deliver:init` to set up the project." and stop.

3. **Read current config**:
   Read `.config/tracey/config.styx`. Verify it contains a `specs (` block — if
   not, say: "Config file exists but does not appear to be in styx format. Inspect
   `.config/tracey/config.styx` manually." and stop. Otherwise parse its contents.

4. **Check required include patterns** — both must be present in the spec `include` list:
   - `openspec/specs/**/*.md` — stable, accumulated specs; always required
   - `openspec/changes/*/specs/**/*.md` — active change specs; required for delivery

   Note any that are missing.

5. **Check required exclude pattern** — must be present in the spec `exclude` list:
   - `openspec/changes/archive/**` — prevents archived change content from being
     double-indexed after it has been synced into `openspec/specs/`

   Note if missing.

6. **Check for stale explicit paths** — these cause duplicate errors and should be
   replaced by the wildcard patterns above:
   - Any path matching `openspec/changes/<name>/specs/**/*.md` where `<name>` is a
     literal change name (not a glob `*`) — made redundant by the wildcard
   - Any path containing `openspec/changes/archive/` — causes duplicates after archive

   Note any found.

7. **Call `tracey_validate`** and record the full output.

8. **Summarise findings**:

   ```
   ## Tracey Health Report

   **Config**: .config/tracey/config.styx

   **Required includes**:
     openspec/specs/**/*.md                  ✓ / ✗ MISSING
     openspec/changes/*/specs/**/*.md        ✓ / ✗ MISSING

   **Archive exclude**:
     openspec/changes/archive/**             ✓ / ✗ MISSING

   **Stale explicit paths**: <list, or "None">

   **tracey_validate**: <"Clean" or list of errors>

   ### Issues found
   <bulleted list of issues, or "None — config is healthy">
   ```

   If no issues are found and `tracey_validate` is clean, stop here.

9. **Apply fixes**:

   If `--fix` was passed, proceed automatically.
   Otherwise, ask:
   > Found <N> issue(s). Apply fixes to `.config/tracey/config.styx`?

   If confirmed, apply all of the following as needed:
   - Add `openspec/changes/*/specs/**/*.md` to the include list if missing
   - Add an `exclude` block containing `openspec/changes/archive/**` if missing
   - Remove any stale explicit paths identified in step 6

   Write the repaired config to `.config/tracey/config.styx`.

10. **Reload and re-validate**:

    Call `tracey_reload` to rebuild the daemon index from the updated config. If
    `tracey_reload` is unavailable (daemon not running or MCP not configured), note
    that the user must restart the Tracey daemon for changes to take effect.
    Call `tracey_validate` to confirm the repair was effective.

    Report:
    ```
    ## Tracey Config Repaired

    **Changes made**:
    - <list each change>

    **tracey_validate after repair**: <"Clean" or remaining errors>
    ```

    If errors remain after repair, display them in full — they likely require
    manual investigation (e.g. actual duplicate requirement IDs in spec files).
