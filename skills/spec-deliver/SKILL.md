---
description: "Orchestrate spec-driven autonomous delivery using OpenSpec, Tracey traceability, and Ralph loop. Use when the user wants to build a feature from an idea through to a PR with full requirement traceability. Detects when a project has openspec/ and .config/tracey/ directories."
argument-hint: "<idea or change-name> [--max-iterations N] [--skip-explore]"
---

# Spec Deliver

Orchestrate the full spec-driven delivery workflow with human checkpoints and
automatic resume on interruption.

See [workflow reference](references/workflow.md) for the end-to-end flow diagram and Tracey integration details.

## Phases

1. **Explore** — Interactive Q&A to refine the idea (human checkpoint)
2. **Propose** — Generate all spec artifacts with Tracey markers
3. **Review** — Present specs for human approval (human checkpoint)
4. **Deliver** — Ralph loop for autonomous implementation
5. **QA** — Code review + build check + test suite pass
6. **Verify** — Validate implementation against specs
7. **Archive** — Sync delta specs and archive the change
8. **PR** — Create a pull request

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

   | State file says | Disk shows               | Actual phase                    |
   | --------------- | ------------------------ | ------------------------------- |
   | exploring       | No change dir            | exploring (restart explore)     |
   | proposing       | Partial artifacts        | proposing (re-run propose)      |
   | reviewing       | All artifacts present    | reviewing (re-ask for approval) |
   | delivering      | Mix of [x] and [ ] tasks | delivering (re-launch ralph)    |
   | qa              | All tasks [x]            | qa (re-run build + tests)       |
   | verifying       | All tasks [x]            | verifying (run verify)          |
   | archiving       | Change not archived      | archiving (run archive)         |
   | any             | Change archived          | complete                        |

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

14. **Verify Tracey config health**:

    Read `.config/tracey/config.styx` and check:

    a. The spec `include` list contains `openspec/changes/*/specs/**/*.md` (the
    wildcard that covers all active changes without per-change edits).
    If missing, add it.

    b. The spec block has an `exclude` list containing `openspec/changes/archive/**`.
    If missing, add it.

    c. If any edits were made, call `tracey_reload` to rebuild the daemon index.
    If `tracey_reload` is unavailable (Tracey daemon not running or MCP not
    configured), note this to the user and advise restarting the daemon before
    delivery begins.

    d. If Tracey MCP tools are available, call `tracey_validate`. If it returns
    errors, report them in full and stop — do not proceed to Review with a broken
    Tracey config. Suggest running `/spec-deliver:tracey-health --fix` to repair.

### Phase 3 — Review

15. **Update state file**: Change `phase: proposing` to `phase: reviewing`.

16. **Extract Tracey requirement IDs** from the generated specs:
    - Use Glob to find `openspec/changes/<change-name>/specs/**/*.md`
    - Read each file and extract all `> r[...]` markers
    - Count total requirements

17. **Present specs for review**:

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

18. **Wait for approval**:

    Use AskUserQuestion with:
    - Question: "Review the specs above. Say **approved** to proceed to Ralph loop delivery, or describe what changes you'd like."
    - This is a free-text question (no preset options).

    **If the user requests changes**: Make the edits, then re-present and re-ask.
    **If the user says "approved"** (or similar affirmative): Proceed to Phase 4.
    **If the user says "cancel"**: Delete the state file and stop.

### Phase 4 — Deliver

19. **Update state file**: Change `phase: reviewing` to `phase: delivering` and set `approved: true`.

20. **Delegate to ralph-deliver**:

    Invoke the Skill tool with:
    - skill: `spec-deliver:ralph-deliver`
    - args: `<change-name> --max-iterations <N>`

    This handles all artifact reading, prompt assembly, and Ralph loop launch.
    When it completes, proceed to cleanup and then Phase 5.

21. **Clean up ralph-loop state**:

    The ralph-loop leaves a state file that must be removed after delivery:

    ```bash
    rm -f .claude/ralph-loop.local.md
    ```

    Also clean up the assembled prompt file if it was written:

    ```bash
    rm -f .claude/spec-deliver-prompt.local.md
    ```

### Phase 5 — QA

22. **Update state file**: Change `phase: delivering` to `phase: qa` and update `updated` date.

23. **Run QA code review via sub-agent**:

    Launch the best available QA sub-agents to review the code changes
    made during delivery. Look for agents with skills like `code-review`, `qa-review`, `static-analysis`, or similar. If multiple are available, you can choose to run them in parallel or sequentially.

    Provide the agent with:
    - The change name
    - The change directory path (`openspec/changes/<change-name>/`)

    Let the agent determine its own review approach. Do not prescribe what to
    check or how to structure its output — just tell it to QA the code changes
    for this change and report any issues.

    Wait for the agent to complete and display its findings to the user.

    Once the reviews are complete, you should address the findings. Do not ignore issues flagged by the QA agent even if they are pre-existing. The goal is to ensure the code is in good shape before proceeding to build and test checks.

24. **Detect build system and run build**:

    Build the project using the appropriate command based on indicators in the repo:

    Attempt to fix the build errors, then re-run the
    build command. Repeat until the build passes.

25. **Detect test framework and run tests**:

    Run the full test suite using the appropriate command based on indicators in the repo:

    Attempt to fix any test failures. Do not ignore any test failures even if they are pre-existing. Then re-run the test command. Repeat until all tests pass.

26. **Report QA results**:

    ```
    ## QA Results

    **Code review**: <passed / <N> critical issues (user acknowledged) / <N> issues fixed>
    **Build**: <passed / skipped / failed (user skipped)>
    **Tests**: <passed (N tests) / skipped / failed (N failures, user skipped)>
    ```

    Proceed to Phase 6.

### Phase 6 — Verify

27. **Update state file**: Change `phase: qa` to `phase: verifying`.

28. **Check Tracey coverage**:
    - Call `tracey_status` MCP tool to get final coverage
    - Call `tracey_uncovered` to list any gaps
    - Call `tracey_untested` to list requirements without test coverage

29. **Run OpenSpec verify**:

    Invoke the Skill tool with:
    - skill: `opsx:verify` (if available)
    - Otherwise, manually check: read each spec requirement and verify corresponding
      code exists with `r[impl ...]` annotation.

30. **Report verification results**:

    ```
    ## Verification Results

    **Tracey coverage**: <percentage>% (<covered>/<total> requirements)
    **Uncovered requirements**: <list or "None">
    **Untested requirements**: <list or "None">
    **OpenSpec verify**: <pass/fail with details>
    ```

    If there are gaps, ask the user:

    > <N> requirements still uncovered. Would you like to:
    >
    > 1. Run another Ralph loop pass to fill gaps
    > 2. Proceed to archive anyway
    > 3. Stop here

### Phase 7 — Archive

31. **Update state file**: Change `phase: verifying` to `phase: archiving`.

32. **Clean up config.styx before archiving**:

    Read `.config/tracey/config.styx` and remove any stale explicit paths that
    would cause duplicate-requirement errors after the archive syncs specs into
    `openspec/specs/`:
    - Remove any explicit include paths containing `openspec/changes/<change-name>/`
      (these are legacy entries made redundant by the `openspec/changes/*/specs/**/*.md`
      wildcard; after archive they point to the archive directory and cause duplicates)
    - Remove any explicit include paths containing `openspec/changes/archive/`
    - Ensure `openspec/changes/*/specs/**/*.md` is in the include list
    - Ensure `openspec/changes/archive/**` is in the exclude list

    If any changes were made, write the file and call `tracey_reload`. If
    `tracey_reload` is unavailable, the user must restart the Tracey daemon
    before the PR is created.

33. **Archive the change**:

    Invoke the Skill tool with:
    - skill: `opsx:archive`
    - args: `<change-name>`

    This syncs delta specs into `openspec/specs/` and moves the change to the archive.

    After archive completes, call `tracey_validate` (if available). If it reports
    duplicate requirements, run the cleanup from step 32 once more and call
    `tracey_reload`, then re-run `tracey_validate`. If errors persist after this
    single retry, report them and stop — the duplicates are likely genuine ID
    conflicts in the spec files themselves and require manual resolution before
    creating the PR.

### Phase 8 — PR

34. **Create a pull request**:

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

35. **Clean up state file**:

    ```bash
    rm .claude/spec-deliver.local.md
    ```

36. **Update state file**: Change `phase: archiving` to `phase: complete`.

37. **Final summary**:

    ```
    ## Delivery Complete: <change-name>

    **PR**: #<number> — <title>
    **Tracey coverage**: <percentage>%
    **Requirements covered**: <N>/<N>
    **Specs archived**: openspec/changes/archive/<date>-<change-name>/

    Spec-driven delivery complete.
    ```
