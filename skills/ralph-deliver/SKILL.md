---
description: "Assemble a Tracey-aware prompt from OpenSpec artifacts and launch a Ralph loop for autonomous delivery"
argument-hint: "<change-name> [--max-iterations N]"
---

# Ralph Deliver

Assemble a Tracey-aware Ralph loop prompt from OpenSpec change artifacts and launch autonomous delivery.
This skill can be used standalone or is called by `/spec-deliver:spec-deliver` during Phase 4.

## Steps

1. **Parse arguments** from `$ARGUMENTS`:
   - Look for `--max-iterations <n>` (or `-n <n>`) anywhere in the arguments. Extract and remove it. Default: 30.
   - The remaining text is the OpenSpec change name.
   - If no change name provided, list active changes:
     ```bash
     openspec list 2>/dev/null
     ```
     Then say: "Usage: `/spec-deliver:ralph-deliver <change-name> [--max-iterations N]`" showing the available changes, and stop.

2. **Verify the change exists and is ready**:
   ```bash
   openspec status --change "<change-name>" --json 2>/dev/null
   ```
   - If the change doesn't exist, say: "No OpenSpec change found with name '<change-name>'. Run `openspec list` to see active changes." and stop.
   - Parse the JSON. Check that all `applyRequires` artifacts have `status: "done"`.
   - If any required artifacts are missing, say: "Change '<change-name>' is not ready for implementation. Missing artifacts: [list]. Run `/opsx:propose` or `/opsx:continue` first." and stop.

3. **Read all change artifacts**:
   - Read `openspec/changes/<change-name>/proposal.md`
   - Read `openspec/changes/<change-name>/tasks.md`
   - Read all spec files: use Glob for `openspec/changes/<change-name>/specs/**/*.md` and read each
   - Read `openspec/changes/<change-name>/design.md` (if it exists)
   - Read `openspec/config.yaml` for project context

4. **Extract Tracey requirement IDs**:
   - Parse all spec files for Tracey markers matching the pattern `> r[...]`
   - Build a list of all requirement IDs (e.g., `data-export.user-can-export-data`)
   - Count total requirements — this becomes the coverage target

5. **Check current Tracey coverage baseline** (if Tracey MCP is available):
   - Call `tracey_status` to get current coverage
   - Note any requirements that are already covered (from prior work)

6. **Read the existing stable specs for context** (if any):
   - Use Glob for `openspec/specs/**/*.md` and read each
   - These provide context about the existing system behaviour

7. **Assemble the Ralph loop prompt**:

   Build the prompt as a single markdown string with these sections:

   ```markdown
   # Task: Implement <change-name>

   You are implementing an OpenSpec change. Work through the tasks below, writing
   production code and tests. Follow TDD: write a failing test, make it pass, refactor.

   ## Project Context

   <contents of openspec/config.yaml context field>

   ## Proposal

   <contents of proposal.md>

   ## Specifications

   <contents of all spec files from the change, concatenated with file path headers>

   ## Design

   <contents of design.md, or "No design document — implement based on specs." if absent>

   ## Existing System Specs

   <contents of stable specs from openspec/specs/, or "No existing specs." if empty>

   ## Tasks

   <contents of tasks.md>

   ## Implementation Rules

   1. Work through tasks in order. After completing each task, check it off in
      openspec/changes/<change-name>/tasks.md by changing `- [ ]` to `- [x]`.

   2. **Tracey annotations are MANDATORY**:
      - Add `// r[impl <req-id>]` above every function/class that implements a requirement
      - Add `// r[verify <req-id>]` above every test that verifies a requirement
      - The requirement IDs are listed in parentheses on each task

   3. **TDD cycle**: For each task:
      a. Write a failing test with `r[verify ...]` annotation
      b. Write minimum code to pass with `r[impl ...]` annotation
      c. Refactor while tests pass
      d. Commit with a descriptive message

   4. After completing each task group, run `tracey_status` to check coverage progress.

   5. Do NOT write placeholder or stub implementations. Every function must be real.

   6. Do NOT assume code doesn't exist — search first before implementing.

   ## Completion Criteria

   This task is COMPLETE when ALL of the following are true:
   - All tasks in tasks.md are checked off (`- [x]`)
   - All <N> Tracey requirements have `impl` references in code
   - All <N> Tracey requirements have `verify` references in tests
   - All tests pass

   When ALL criteria are met, output: <promise>RALPH_DELIVER_COMPLETE</promise>
   Do NOT output the promise until everything is genuinely done.
   ```

   Replace `<change-name>`, `<N>` (requirement count), and all content placeholders with actual values.

8. **Display summary to user**:

   ```
   ## Ralph Deliver: <change-name>

   **Artifacts**: proposal.md, specs (N files), design.md, tasks.md
   **Tracey requirements**: N requirement IDs to cover
   **Max iterations**: N
   **Completion gate**: All tasks done + full Tracey coverage

   ### Requirement IDs
   <bulleted list of all r[...] IDs>

   Launching Ralph loop...
   ```

9. **Launch the Ralph loop**:

   Invoke the `/ralph-loop` skill with the assembled prompt:

   Use the Skill tool with:
   - skill: `ralph-loop`
   - args: `<assembled-prompt> --max-iterations <N> --completion-promise "RALPH_DELIVER_COMPLETE"`

   Note: The prompt may be very long. If the Skill tool cannot handle it, write the
   prompt to `.claude/spec-deliver-prompt.local.md` and use Bash to invoke:
   ```bash
   # Write prompt to file, then reference it
   ```

   If the Skill tool approach fails, fall back to writing the prompt to
   `.claude/spec-deliver-prompt.local.md` and instruct the user to run:
   ```
   /ralph-loop "$(cat .claude/spec-deliver-prompt.local.md)" --max-iterations <N> --completion-promise "RALPH_DELIVER_COMPLETE"
   ```

## Post-Completion

After the Ralph loop completes (or hits max iterations):

1. Run `tracey_status` to report final coverage
2. Run `tracey_uncovered` to list any remaining gaps
3. Suggest next steps:
   - If complete: "Run `/opsx:verify` to validate, then `/opsx:archive` to archive."
   - If incomplete: "N requirements still uncovered. Review gaps and consider another `/spec-deliver:ralph-deliver` pass or manual implementation."
