---
name: "Spec Deliver"
description: "Orchestrate spec-driven autonomous delivery: explore → propose → review → deliver → verify → archive"
argument-hint: "<idea or change-name> [--max-iterations N] [--skip-explore]"
---

# Spec Deliver

Orchestrate the full spec-driven delivery workflow with human checkpoints and
automatic resume on interruption.

## Phases

1. **Explore** — Interactive Q&A to refine the idea (human checkpoint)
2. **Propose** — Generate all spec artifacts with Tracey markers
3. **Review** — Present specs for human approval (human checkpoint)
4. **Deliver** — Ralph loop for autonomous implementation
5. **Verify** — Validate implementation against specs
6. **Archive** — Sync delta specs and archive the change
7. **PR** — Create a pull request

## Steps

### Phase 0 — Parse & Resume

1. **Parse arguments** from `$ARGUMENTS`:
   - Look for `--max-iterations <n>` (or `-n <n>`). Extract and remove. Default: 30.
   - Look for `--skip-explore` flag. Extract and remove. Default: false.
   - The remaining text is either a change name (kebab-case, no spaces) or a
     free-text idea description.

2. **Check for existing state file**:

   Use Bash to check:
   ```bash
   test -f .claude/spec-deliver.local.md && echo "EXISTS" || echo "NOT_FOUND"
   ```

   **If EXISTS** — proceed to **Phase 0A: Resume**.
   **If NOT_FOUND** — proceed to **Phase 1: Explore** (or Phase 2 if `--skip-explore`).

### Phase 0A — Resume

3. **Read the state file** at `.claude/spec-deliver.local.md`.
   Extract frontmatter fields: `change`, `phase`, `approved`, `max_iterations`.

4. **Cross-reference with on-disk state** to validate:

   a. Check if the change directory exists:
   ```bash
   test -d "openspec/changes/${CHANGE}" && echo "EXISTS" || echo "NOT_FOUND"
   ```

   b. If the change exists, get artifact status:
   ```bash
   openspec status --change "${CHANGE}" --json
   ```

   c. Check task progress in `tasks.md` (if it exists):
   - Count `- [x]` (completed) and `- [ ]` (pending)

   d. Check if change was already archived:
   ```bash
   test -d "openspec/changes/archive/*-${CHANGE}" && echo "ARCHIVED" || echo "NOT_ARCHIVED"
   ```

5. **Determine actual phase** by reconciling state file with disk:

   | State file says | Disk shows | Actual phase |
   |---|---|---|
   | exploring | No change dir | exploring (restart explore) |
   | proposing | Partial artifacts | proposing (re-run propose) |
   | reviewing | All artifacts present | reviewing (re-ask for approval) |
   | delivering | Mix of [x] and [ ] tasks | delivering (re-launch ralph) |
   | verifying | All tasks [x] | verifying (run verify) |
   | archiving | Change not archived | archiving (run archive) |
   | any | Change archived | complete |

6. **Display resume summary**:

   ```
   ## Resuming: spec-deliver for "<change-name>"

   **Phase**: <current phase>
   **Tasks**: <completed>/<total> (<percentage>%)
   **Approved**: <yes/no>

   Continuing from <phase description>...
   ```

7. **Jump to the appropriate phase** below.

### Phase 1 — Explore

8. **Derive a change name** from the input:
   - If the input is already kebab-case with no spaces, use it as the change name
   - Otherwise, derive a kebab-case name from the idea (e.g., "add user authentication" → `add-user-auth`)

9. **Create the state file** at `.claude/spec-deliver.local.md`:

   ```markdown
   ---
   change: <change-name>
   phase: exploring
   approved: false
   max_iterations: <N>
   started: <today YYYY-MM-DD>
   updated: <today YYYY-MM-DD>
   ---

   <original idea text>
   ```

10. **Run explore**:

    Invoke the Skill tool with:
    - skill: `opsx:explore`
    - args: `<idea text>`

    This starts an interactive conversation. The user will answer questions and
    refine the idea. When the exploration naturally concludes (the user says
    something like "looks good", "let's go", "that's enough"), proceed to Phase 2.

    **IMPORTANT**: Do NOT rush through explore. Let the user drive the conversation.
    The quality of the specs depends on thorough exploration.

### Phase 2 — Propose

11. **Update state file**: Change `phase: exploring` to `phase: proposing` and update `updated` date.

12. **Run propose**:

    Invoke the Skill tool with:
    - skill: `opsx:propose`
    - args: `<change-name>`

    This generates all artifacts (proposal.md, specs with Tracey markers, design.md, tasks.md).

13. **Verify artifacts were created**:
    ```bash
    openspec status --change "<change-name>" --json
    ```
    Check all `applyRequires` artifacts have `status: "done"`.
    If not, report what's missing and stop.

### Phase 3 — Review

14. **Update state file**: Change `phase: proposing` to `phase: reviewing`.

15. **Extract Tracey requirement IDs** from the generated specs:
    - Use Glob to find `openspec/changes/<change-name>/specs/**/*.md`
    - Read each file and extract all `> r[...]` markers
    - Count total requirements

16. **Present specs for review**:

    Display:
    ```
    ## Specs Ready for Review

    **Change**: <change-name>
    **Artifacts**: proposal.md, specs (<N> files), design.md, tasks.md
    **Tracey requirements**: <N> requirement IDs

    ### Requirement IDs
    <bulleted list of all r[...] IDs>

    ### Files to review
    - openspec/changes/<change-name>/proposal.md
    - openspec/changes/<change-name>/specs/<capability>/spec.md (for each)
    - openspec/changes/<change-name>/design.md
    - openspec/changes/<change-name>/tasks.md

    Please review the specs. You can:
    - Edit any file directly
    - Ask me to modify specific requirements
    - Say **"approved"** to proceed to autonomous delivery
    - Say **"cancel"** to stop
    ```

17. **Wait for approval**:

    Use AskUserQuestion with:
    - Question: "Review the specs above. Say **approved** to proceed to Ralph loop delivery, or describe what changes you'd like."
    - This is a free-text question (no preset options).

    **If the user requests changes**: Make the edits, then re-present and re-ask.
    **If the user says "approved"** (or similar affirmative): Proceed to Phase 4.
    **If the user says "cancel"**: Delete the state file and stop.

### Phase 4 — Deliver

18. **Update state file**: Change `phase: reviewing` to `phase: delivering` and set `approved: true`.

19. **Assemble the Ralph loop prompt**:

    Read all change artifacts:
    - `openspec/changes/<change-name>/proposal.md`
    - All spec files from `openspec/changes/<change-name>/specs/**/*.md`
    - `openspec/changes/<change-name>/design.md` (if exists)
    - `openspec/changes/<change-name>/tasks.md`
    - `openspec/config.yaml` for project context
    - All stable specs from `openspec/specs/**/*.md` (if any)

    Extract all Tracey requirement IDs from the spec files.

    Build the prompt:

    ```markdown
    # Task: Implement <change-name>

    You are implementing an OpenSpec change. Work through the tasks below, writing
    production code and tests. Follow TDD: write a failing test, make it pass, refactor.

    ## Project Context

    <contents of openspec/config.yaml context field>

    ## Proposal

    <contents of proposal.md>

    ## Specifications

    <contents of all spec files, concatenated with file path headers>

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

20. **Write prompt to file** (in case it's too long for inline):
    Write the assembled prompt to `.claude/spec-deliver-prompt.local.md`.

21. **Launch Ralph loop**:

    Invoke the Skill tool with:
    - skill: `ralph-loop`
    - args: the assembled prompt text followed by ` --max-iterations <N> --completion-promise "RALPH_DELIVER_COMPLETE"`

    If that fails due to argument length, instruct the user:
    > The prompt is too long to pass inline. Please run:
    > ```
    > /ralph-loop "$(cat .claude/spec-deliver-prompt.local.md)" --max-iterations <N> --completion-promise "RALPH_DELIVER_COMPLETE"
    > ```

### Phase 5 — Verify

22. **Update state file**: Change `phase: delivering` to `phase: verifying`.

23. **Check Tracey coverage**:
    - Call `tracey_status` MCP tool to get final coverage
    - Call `tracey_uncovered` to list any gaps
    - Call `tracey_untested` to list requirements without test coverage

24. **Run OpenSpec verify**:

    Invoke the Skill tool with:
    - skill: `opsx:verify` (if available)
    - Otherwise, manually check: read each spec requirement and verify corresponding
      code exists with `r[impl ...]` annotation.

25. **Report verification results**:

    ```
    ## Verification Results

    **Tracey coverage**: <percentage>% (<covered>/<total> requirements)
    **Uncovered requirements**: <list or "None">
    **Untested requirements**: <list or "None">
    **OpenSpec verify**: <pass/fail with details>
    ```

    If there are gaps, ask the user:
    > <N> requirements still uncovered. Would you like to:
    > 1. Run another Ralph loop pass to fill gaps
    > 2. Proceed to archive anyway
    > 3. Stop here

### Phase 6 — Archive

26. **Update state file**: Change `phase: verifying` to `phase: archiving`.

27. **Archive the change**:

    Invoke the Skill tool with:
    - skill: `opsx:archive`
    - args: `<change-name>`

    This syncs delta specs into `openspec/specs/` and moves the change to the archive.

### Phase 7 — PR

28. **Update state file**: Change `phase: archiving` to `phase: complete`.

29. **Create a pull request**:

    Check if there are commits to push:
    ```bash
    git log --oneline origin/HEAD..HEAD 2>/dev/null | head -5
    ```

    If there are commits:
    - Push the branch
    - Create a PR using `gh pr create` with:
      - Title based on the change name and proposal summary
      - Body including:
        - Summary from proposal.md
        - List of Tracey requirement IDs covered
        - Tracey coverage percentage
        - Link to archived specs

30. **Clean up state file**:
    ```bash
    rm .claude/spec-deliver.local.md
    rm -f .claude/spec-deliver-prompt.local.md
    ```

31. **Final summary**:

    ```
    ## Delivery Complete: <change-name>

    **PR**: #<number> — <title>
    **Tracey coverage**: <percentage>%
    **Requirements covered**: <N>/<N>
    **Specs archived**: openspec/changes/archive/<date>-<change-name>/

    Spec-driven delivery complete.
    ```
