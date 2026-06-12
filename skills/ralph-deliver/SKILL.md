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

   While reading, extract three things that feed the assembled prompt:

   a. **Constraints / out-of-scope** — anything the proposal or design says must
      NOT change ("do NOT touch", "out of scope", "do not modify"), plus any
      resolved decisions that must be honoured exactly. These become a hard
      boundary in the prompt.

   b. **Out-of-band / manual steps** — anything an autonomous agent cannot do:
      provisioning, secrets, external dashboard or account settings, infra or
      permission changes. The loop must be told NOT to attempt these so it does
      not burn iterations on the impossible.

   c. **Verification commands** — the repo's test, lint, type-check, and build
      commands. Detect them from the proposal/design, `openspec/config.yaml`, or
      the repo's conventions (`package.json` scripts, `Makefile`, `pyproject.toml`,
      CI config under `.github/workflows/`). The loop gates on these, so they must
      be concrete commands, not "run the tests".

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

   You are implementing an OpenSpec change. Your job is to create an agent team
   to deliver this work. Analyse the tasks, specs, and design below, then create
   an appropriate agent team to implement the change in parallel.

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

   ## Constraints / Out of Scope

   <constraints and out-of-scope items extracted from the proposal/design, or
   "No explicit constraints recorded — stay within the scope of the tasks above.">

   ## Verification Commands

   <the repo's actual test / lint / type-check / build commands, one per line, or
   "Detect from repo conventions before the first acceptance gate." if none could
   be determined>

   ## Out-of-Band Steps

   <manual steps the loop must NOT attempt (provisioning, secrets, infra), or "None.">

   ## Delivery Instructions

   You are the **orchestrator**. Create an agent team to implement the tasks above
   and coordinate it; you do NOT implement the tasks yourself, and you do NOT mark a
   task done on a teammate's say-so. You decide the team composition — the number of
   teammates, their roles, and how to divide the work — based on the nature of the
   work. Alongside the implementers, run at least one independent **reviewer** (a QA
   + adversarial lens) that reviews each diff before you accept it.

   ### Rules every implementer must follow

   1. **Strict TDD — red→green evidence is mandatory for every code-bearing task:**
      a. **Red:** write the failing test(s) for the requirement FIRST, annotated
         `// r[verify <req-id>]`. Run them and confirm they fail **for the right
         reason** — a real assertion failure, not an import/syntax/setup error. No
         production code before a failing test exists for it.
      b. **Green:** write the **minimum** code to pass, annotated
         `// r[impl <req-id>]`. Run the test(s); confirm green.
      c. **Refactor:** clean up while tests stay green.
      d. **Evidence:** include the red→green transition (the failing output, then
         the passing output) in the summary you return to the orchestrator, so TDD
         can be verified as followed, not retrofitted.
      Non-code tasks (docs, config, spec text) have no test — provide the exact diff
      plus passing output of the relevant lint/validator command instead.

   2. **Tracey annotations are MANDATORY** — `// r[impl <req-id>]` above every
      function/class that implements a requirement, `// r[verify <req-id>]` above
      every test that verifies one. The requirement IDs are in parentheses on each
      task.

   3. Do NOT write placeholder or stub implementations. Every function must be real.

   4. Do NOT assume code doesn't exist — search first before implementing.

   5. **Respect the Constraints / Out of Scope section above** — do not modify
      anything listed there, and honour every resolved decision exactly.

   6. Do NOT attempt the Out-of-Band Steps listed above. Note them as human action
      items and move on; they do not block a task's acceptance.

   7. **Boy-scout rule** — leave code better than you found it:
      - You are encouraged to make targeted improvements to code encountered in the
        path of your work: fix small bugs, remove dead code, improve naming, clean up
        minor technical debt, or address code quality issues.
      - Significant changes outside the direct scope of this change (large refactors,
        structural redesigns, dependency upgrades) should only be undertaken if they
        directly block progress, block value delivery, or would force a materially
        inferior solution due to existing technical debt or bugs. In those cases,
        note what you changed and why in the commit message.
      - When in doubt, keep boy-scout changes small and targeted. A one-line fix is
        always welcome; a cross-cutting refactor is not unless it is unavoidable.

   ### Orchestrator acceptance gate (run for EVERY task)

   A task may only be marked `- [x]` in openspec/changes/<change-name>/tasks.md
   after YOU — not the implementer — have independently confirmed ALL of:

   - the change matches the spec/task and honours every resolved decision;
   - (code tasks) the red→green evidence is real — the test genuinely failed first
     for the right reason, then passed;
   - the **Verification Commands** above (tests, lint, type-check, build) pass when
     YOU re-run them yourself;
   - nothing in the Constraints / Out of Scope section was touched;
   - the independent reviewer has reviewed the diff and no blocking finding remains.

   Read the diff yourself before accepting — never accept on the implementer's
   report alone. If a task fails the gate, send the implementer one consolidated
   list of required changes, then re-review when they report done. Repeat until it
   passes, then check the task off and commit it with a descriptive message.

   After each accepted task group, run `tracey_status` to check coverage progress.

   ## Completion Criteria

   This task is COMPLETE when ALL of the following are true:
   - All tasks in tasks.md are checked off (`- [x]`) — each having passed the
     orchestrator acceptance gate above;
   - All <N> Tracey requirements have `impl` references in code;
   - All <N> Tracey requirements have `verify` references in tests;
   - The full verification suite passes — tests, lint, type-check, and build.

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
   **Completion gate**: All tasks accepted + full Tracey coverage + tests/lint/type-check/build pass

   ### Requirement IDs
   <bulleted list of all r[...] IDs>

   ### Human action items (out-of-band — the loop will NOT do these)
   <bulleted list of out-of-band steps, or "None.">

   Launching Ralph loop...
   ```

9. **Pre-flight Tracey validation**:

   Call `tracey_validate`. If it returns errors:

   - **Duplicate requirement errors**: Read `.config/tracey/config.styx`, remove any
     explicit paths containing `openspec/changes/archive/`, call `tracey_reload`, then
     re-run `tracey_validate`.

   - **Errors persist**: Report the full `tracey_validate` output and stop. The
     completion criterion (`tracey_uncovered` returning 0) cannot function with a
     broken Tracey index — launching Ralph now will produce a loop that never
     terminates cleanly.

   - **Config looks correct but Tracey is unhappy**: Suggest running
     `/spec-deliver:tracey-health --fix` and retrying.

   If `tracey_validate` is clean, proceed.

10. **Launch the Ralph loop**:

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

1. **Clean up ralph-loop state files** (standalone use only — when invoked via
   `/spec-deliver:spec-deliver`, the orchestrator handles this cleanup):
   ```bash
   rm -f .claude/ralph-loop.local.md
   rm -f .claude/spec-deliver-prompt.local.md
   ```

2. Run `tracey_status` to report final coverage
3. Run `tracey_uncovered` to list any remaining gaps
4. Suggest next steps:
   - If invoked via `/spec-deliver:spec-deliver`: return to the orchestrator — it
     will handle QA, verify, archive, and PR automatically.
   - If complete (standalone): "The loop's per-task gate is not a substitute for a
     full independent review. Run `/spec-deliver:parallel-review` for a multi-lens
     pass, then `/opsx:verify` to validate, then `/opsx:archive` to archive."
   - If incomplete (standalone): "N requirements still uncovered. Review gaps and consider another `/spec-deliver:ralph-deliver` pass or manual implementation."
