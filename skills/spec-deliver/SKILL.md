---
description: "Take a change from idea to pull request: short spec, human approval, test-first delivery checked by a deterministic gate, specialist review, and an evidence pack. Use when the user wants to build a feature or fix through to a PR. Detects when a project has .config/spec-deliver/verify."
argument-hint: "<idea or change-name> [--quick] [--high-risk] [--skip-explore] [--max-output-tokens N]"
---

# Spec Deliver

Take a change from idea to PR, with human checkpoints and automatic resume.

See the [workflow reference](references/workflow.md) for the flow, the gate and the commit trailers.

## Tiers

| Tier | Use for | Spec | Human checkpoints |
| --- | --- | --- | --- |
| `--quick` | Bug fixes and small changes | Acceptance criteria only, no OpenSpec artifacts | Approve the criteria, review the PR |
| Standard (default) | Features | Proposal, short spec, stub design, tasks | Approve the spec, review the PR |
| `--high-risk` | Auth, payments, data migrations | Proposal, spec, full design, tasks | Approve the spec, sign off each group, review the PR |

If the request touches auth, payments, personal data or migrations and `--high-risk` was not passed, ask the user whether to use it.

## Phases

1. **Explore**: refine the idea with the user
2. **Propose**: write the spec artifacts
3. **Approve**: human approval, recorded in a commit
4. **Deliver**: the `spec-deliver:deliver` workflow, group by group
5. **QA**: specialist review, then triage
6. **Verify**: `spec-deliver-gate final` and the evidence pack
7. **Archive**: sync specs and archive the change
8. **PR**: open a pull request for human review

## Steps

### Phase 0: Parse, check and resume

1. **Parse arguments** from `$ARGUMENTS`. Extract and remove `--quick`, `--high-risk`, `--skip-explore` and `--max-output-tokens <n>`. `--quick` and `--high-risk` cannot be combined. The remaining text is a change name (kebab-case, no spaces) or a free-text idea.

2. **Check prerequisites**:

   - The Workflow tool must be available. If it is not, stop and say: "spec-deliver needs dynamic workflows. Enable Dynamic workflows in `/config`, or ask your admin if `disableWorkflows` is set."
   - `command -v spec-deliver-gate` must succeed. If it does not, stop and say the plugin is not enabled in this session.
   - `.config/spec-deliver/verify` must exist. If it does not, stop and tell the user to run `/spec-deliver:init`.

3. **Check for a state file**:

   ```bash
   test -f .claude/spec-deliver.local.md && echo "EXISTS" || echo "NOT_FOUND"
   ```

   If it exists and `$ARGUMENTS` names a different change, ask the user whether to resume the old change or abandon it. Abandoning deletes the state file and leaves its branch and commits alone. Otherwise, if it exists, go to Phase 0A. If it does not, go to step 7.

### Phase 0A: Resume

4. **Read the state file** at `.claude/spec-deliver.local.md`. Extract `change`, `branch`, `phase`, `tier` and `approved_sha`.

   If `git branch --show-current` differs from `branch`, run `git switch <branch>`. Never resume on another branch, because the next commit would land there.

5. **Reconcile with disk**:

   ```bash
   ls -d openspec/changes/archive/*-"${CHANGE}" >/dev/null 2>&1 && echo "ARCHIVED" || echo "NOT_ARCHIVED"
   ```

   For standard and high-risk tiers, also count `- [x]` and `- [ ]` in `openspec/changes/<change>/tasks.md`, and run `openspec status --change "<change>" --json`.

   | State file says | Disk shows | Actual phase |
   | --------------- | ---------- | ------------ |
   | exploring | No change dir | exploring |
   | proposing | Partial artifacts | proposing |
   | reviewing | All artifacts present | reviewing (ask for approval again) |
   | delivering | Mix of [x] and [ ] tasks | delivering (restart the workflow, it resumes from commits) |
   | delivering | All tasks [x] | qa (delivery finished) |
   | qa | All tasks [x] | qa |
   | verifying | All tasks [x] | verifying |
   | archiving | Change not archived | archiving |
   | any | Change archived | PR |

   Quick deliveries have no tasks file, so trust the state file's phase. Their acceptance criteria live in the approval commit, so recover them with `git show -s --format=%b <approved_sha>`. If the phase is still `reviewing`, write the criteria again.

   If the phase is `delivering` or later, check the approval with `git merge-base --is-ancestor <approved_sha> HEAD`. If `approved_sha` is empty or not an ancestor of HEAD, tell the user and go back to Phase 3. A state file from 3.x has no approval, and the workflow refuses to run without one.

6. **Show a resume summary** with the change, phase, tier and task progress, then jump to that phase.

### Phase 1: Explore

7. **Derive a change name**. If the input is already kebab-case with no spaces, use it. Otherwise derive one (for example "add user authentication" becomes `add-user-auth`).

8. **Create a working branch**. Never deliver on the default branch:

   ```bash
   git symbolic-ref --short refs/remotes/origin/HEAD
   ```

   ```bash
   git branch --show-current
   ```

   The first command prints the default branch as `origin/<name>`. If it fails, assume `main`. If the current branch is the default branch, run `git switch -c spec/<change-name>`. If you are already on another branch, stay on it. If the current branch is empty (detached HEAD), stop and ask the user to check out a branch.

9. **Create the state file** at `.claude/spec-deliver.local.md`:

   ```markdown
   ---
   change: <change-name>
   branch: <current branch>
   phase: exploring
   tier: <quick|standard|high-risk>
   approved_sha:
   started: <today YYYY-MM-DD>
   updated: <today YYYY-MM-DD>
   ---

   <original idea text>
   ```

   Update `phase` and `updated` at the start of each later phase.

10. **Explore**. Steps 7 to 9 always run: with `--quick` or `--skip-explore`, skip only step 10.

    Invoke the Skill tool with skill `opsx:explore` and args `<idea text>`. Let the user drive. When they say something like "looks good" or "let's go", continue to Phase 2.

### Phase 2: Propose

**`--quick`**: skip OpenSpec. Write the acceptance criteria as a short list, each one something a test can prove. Go to Phase 3.

11. **Generate artifacts**. Invoke the Skill tool with skill `opsx:propose` and args `<change-name>`.

    Keep specs short. A long spec is not more accurate, and it costs review time. For standard tier, a stub `design.md` is enough: the stock schema requires the file, not an essay. For `--high-risk`, write a full design.

    If you edit requirement blocks by hand, keep to these rules, which `openspec validate --strict` enforces in CI:

    - Each requirement body uses SHALL or MUST.
    - Inside `openspec/changes/<name>/specs/`, use delta headers such as `## ADDED Requirements`. Main specs at `openspec/specs/<capability>/spec.md` use `# <Capability> Specification`, `## Purpose` and `## Requirements`.
    - Every requirement has at least one `#### Scenario:`.

12. **Check the artifacts**:

    ```bash
    openspec status --change "<change-name>" --json
    openspec validate "<change-name>" --strict
    ```

    All `applyRequires` artifacts must have `status: "done"`, and validation must pass. If not, fix or report what is missing and stop.

    Check that `tasks.md` uses numbered `## <n>. <title>` group headings. Mark a group `(no-test)` or `(refactor)` in its heading where that applies, for example `## 3. Update docs (no-test)`. Each group is delivered by fresh agents, so it must make sense on its own.

### Phase 3: Approve

13. **Present for review**. Show the change name, tier, files to read (or the acceptance criteria for `--quick`), task groups, and the commands in `.config/spec-deliver/verify`. Those commands define done, and they are frozen at approval.

14. **Wait for approval**. Use AskUserQuestion: "Review the spec. Say **approved** to start delivery, or describe what to change." This is the main quality gate, so never skip it or infer approval.

    If the user requests changes, make them and ask again. If they cancel, delete the state file and stop.

15. **Record the approval** in a commit. The gate refuses any commit without this trailer.

    Standard and high-risk:

    ```bash
    git add openspec/changes/<change-name> .config/spec-deliver/verify
    git commit -m "spec: approve <change-name>" -m "Spec-Approved: <change-name>"
    ```

    Quick, keeping the criteria in the commit body:

    ```bash
    git add .config/spec-deliver/verify
    git commit --allow-empty -m "spec: approve <change-name>" -m "<acceptance criteria>" -m "Spec-Approved: <change-name>"
    ```

    Save `git rev-parse --short HEAD` as `approved_sha` in the state file. If `git status --porcelain` still shows other changes, stop and ask the user to commit or stash them, because the gate needs a clean tree.

### Phase 4: Deliver

16. **Build the workflow input**:

    - `approvedSha`: the state file's `approved_sha`.
    - `change`: the change name. Omit it for `--quick`, and pass `brief` with the acceptance criteria instead.
    - `groups`: one `{id, title, kind}` per group in `tasks.md` that still has unticked tasks. `id` is the heading number, and `kind` is `code`, `no-test` or `refactor`. For `--quick`, use `[{id: "1", title: "<summary>", kind: "code"}]`. If the verify file has no `test` line, there is nothing to run red against, so use `kind: "no-test"`.
    - `constraints`: anything the proposal or design says must not change, plus resolved decisions.
    - `maxOutputTokens`: the `--max-output-tokens` value, if given.

17. **Start delivery**. Call the Workflow tool with name `spec-deliver:deliver` and those `args`. For `--high-risk`, pass one group per run.

    Tell the user delivery has started and that `/workflows` shows progress. Then **end your turn**. The workflow runs in the background and its completion notification restarts you here.

18. **When the workflow finishes**, read its result:

    - `complete`: continue. For `--high-risk`, sign-off covers every group, including the last: show what the group changed and ask with AskUserQuestion, then repeat step 17 if groups remain.
    - `stopped`: report `reason`, `group` and `detail`, and ask the user how to proceed. Do not work around a stop. Rerunning resumes from commits.
    - `refused`: report the reason and stop.

    Carry the result's `notes` into Phase 5.

### Phase 5: QA

19. **Run the review**. Invoke the Skill tool with skill `spec-deliver:parallel-review`, and args `<base> --change <change-name>` where base is the default branch. Prefer `origin/<default>`. Omit `--change` for `--quick`, and add `--all-lenses` for `--high-risk`. It starts a background workflow, so end your turn and continue when it reports.

    Success is **coverage, not zero findings**: every file has a verdict and any failed lens is flagged. Zero findings is empirically unreachable with stochastic reviewers (arXiv:2509.01494).

20. **Triage**:

    - **Critical / High**: fix before continuing. If the engineer defers one, record that in the evidence pack.
    - **Medium**: surface to the engineer. By default, fix now.
    - **Low / Info**: mention briefly. The engineer decides.

    After fixes, run the verify commands again. Rerun the review only if fixes were extensive.

21. **Commit**. If `--change` was used, always commit the review report. If anything else changed, commit the QA fixes too, so Phase 8 pushes them. `git status --porcelain` must be empty before Phase 6, because the gate fails on a dirty tree.

### Phase 6: Verify

22. **Run the final gate** yourself, from this session. Do not delegate it:

    ```bash
    spec-deliver-gate final --approved <approved_sha> --change <change-name>
    ```

    Omit `--change` for `--quick`. If the last line is not `GATE final PASS`, report it and stop. Never report a delivery as done without this pass. If the engineer decides to proceed anyway, record that decision in the evidence pack and the PR.

23. **Map scenarios to tests**. For each `#### Scenario:` in the change's specs (or each acceptance criterion), name the test that proves it. A scenario with no test is a gap: report it and ask the engineer whether to deliver it or accept the gap.

24. **Write the evidence pack** to `openspec/changes/<change-name>/evidence.md`, and commit it. For `--quick`, put this in the PR body instead.

    ```markdown
    # Evidence: <change-name>

    **Approved commit**: <sha>
    **Tier**: <tier>

    ## Gate
    <the final gate's last line, and the verify commands it ran>

    ## Red to green
    <per group: tail of spec-deliver/<group>.red.log under `git rev-parse --absolute-git-dir`, showing why the tests failed first, or the no-test reason>

    ## Scenarios
    | Scenario | Test |
    | --- | --- |

    ## Review
    <verdict, lenses run and skipped, finding counts, path to the report>

    ## Deferred
    <deferred findings and accepted gaps with the engineer's reason, or "None">

    ## Human action items
    <out-of-band steps from the proposal, or "None">
    ```

### Phase 7: Archive

Skip this phase for `--quick`.

25. **Archive the change**. Invoke the Skill tool with skill `opsx:archive` and args `<change-name>`. This syncs delta specs into `openspec/specs/` and moves the change to the archive.

    Then commit the archive output (the synced `openspec/specs/` deltas and the moved change directory) with a descriptive message.

### Phase 8: PR

26. **Create the pull request**. Run `gh pr view` first: if a PR already exists for this branch, push and skip to the next step. Otherwise push the branch and run `gh pr create`. Build the body from the evidence pack: summary, gate result, scenario table, review verdict, deferred items and human action items. Link the archived change.

    Merging stays with a human. Say so in your summary.

27. **Clean up**. Delivery is complete once the state file is gone:

    ```bash
    rm .claude/spec-deliver.local.md
    ```

28. **Final summary**:

    ```
    ## Delivery complete: <change-name>

    **PR**: #<number>: <title>
    **Gate**: <final gate line>
    **Review**: <verdict>, <N> findings fixed, <K> deferred
    **Waiting on**: human PR review
    ```
