# Spec Deliver Workflow Reference

## End-to-End Flow

```
/spec-deliver:spec-deliver "description"
    │
    ├─ Branch: never on the default branch
    ├─ 1 EXPLORE: /opsx:explore, interactive
    ├─ 2 PROPOSE: /opsx:propose writes proposal, spec, design, tasks
    ├─ 3 APPROVE ← HUMAN GATE
    │   ├─ gate preflight: protected paths in the plan, verify commands pass
    │   └─ commit with a Spec-Approved trailer freezes specs and verify commands
    │
    ├─ 4 DELIVER: workflow spec-deliver:deliver, per task group
    │   ├─ test-writer commits failing tests     (Red-For: <group>)
    │   ├─ gate red: tests must fail
    │   ├─ implementer, fresh context
    │   ├─ reviewer reads the diff, the red log, and the work so far
    │   │   against design.md, constraints and earlier groups
    │   └─ gate task: verify commands and the group's Gate: command pass,
    │       tests and protected paths untouched,
    │       then ticks tasks.md and commits       (Green-For: <group>)
    │       └─ up to 2 forward-only retries, then stop and report
    │   └─ conformance: the whole diff since approval against the whole change
    │       ├─ a verdict per scenario, design, constraints, the proposal's goal
    │       ├─ testable findings become a conf-<sha> fix group, then review again
    │       │   (up to 2 fix rounds, then stop and report)
    │       └─ findings no test can prove stop for a human
    │
    ├─ 5 QA: workflow spec-deliver:review
    │   ├─ qa and adversarial lenses read the change
    │   ├─ lenses chosen by diff, verify each finding, dedup, rank, report file
    │   └─ testable fixes go back through deliver as qa<n> groups
    ├─ 6 VERIFY: gate final from the main session, then the evidence pack
    ├─ 7 ARCHIVE: /opsx:archive, commit
    └─ 8 PR: end state and diagrams in the body, evidence linked ← HUMAN GATE
```

`--quick` skips Explore, Propose and Archive. `--signoff` runs one workflow per group, with human sign-off between groups.

## The Gate

`spec-deliver-gate` lives in the plugin's `bin/`, so it is on `PATH` whenever the plugin is enabled. It is the only definition of done. No agent's claim counts until the gate says so.

| Mode | Checks |
| --- | --- |
| `version` | Prints the plugin version |
| `preflight` | Before approval: names the given paths that are protected, and runs the working-tree verify commands |
| `baseline` | Clean tree, verify commands pass |
| `status` | Reports `none`, `red-unchecked`, `red` or `green` for a group. Fails on a `Green-For` that `task` did not write |
| `red` | HEAD is the group's `Red-For` commit, it touches a test file, and the test command fails |
| `test-fix` | HEAD is a `Test-Fix-For` commit that touches only tests, made after a checked red and before green |
| `task` | Clean tree, HEAD is the reviewed commit (`--head`), protected paths intact, no test edits since red or the last test fix, a tracked code change since red, verify commands pass, the group's `Gate:` command passes. Then ticks the group and commits `Green-For` |
| `final` | All of the above across every group, every approved group delivered, every `Gate:` command checked at its accepted commit, group tests still present, every task ticked, verify commands pass |

The last line of output is always `GATE <mode> <PASS|FAIL|ERROR> ...`. Exit codes are 0 pass, 1 fail, 2 usage or configuration error.

### Trust model

The gate holds honest agents to account. It is not tamper-proof, because an agent with a shell can forge local records in `.git/spec-deliver/`. The real controls are the main session rerunning `gate final`, consumer CI, and human review of the PR.

The gate catches edited tests, not vacuous ones. Only the group reviewer and human review catch a test that proves nothing, unless a `Gate:` command, such as a mutation run, proves the tests for that group.

## The Verify File

`.config/spec-deliver/verify` is committed, and the gate reads it from the approved commit, so changes during delivery have no effect.

```
# label: command
test: npm test
lint: npm run lint
build: npm run build
```

Every `label: command` line runs, and any other line that is not a comment is an error. `test` is the command `gate red` expects to fail. Three keys are reserved:

| Key | Purpose |
| --- | --- |
| `test-files: <regex>` | Replaces the default pattern for what counts as a test file |
| `protect: <regex>` | Replaces the default protected paths |
| `allow: <regex>` | Exempts matching paths from protection, and keeps the rest |

The defaults protect the verify file, CI workflows, Claude settings, stable specs, the change's spec, proposal and design, and common test runner config. If a change must edit a protected path, add an `allow:` line before approval. `gate preflight` lists the protected paths a plan touches.

Generated lock files, such as `packages.lock.json` or `pnpm-lock.yaml`, never count as test files, even inside a test project.

The gate runs verify commands and `Gate:` commands from the approved commit, but not the scripts or config files they read. If a command runs a repo script, add that script to `protect:`, along with any manifest that defines the command, such as `package.json`. Put pass conditions in the command itself, for example `--break-at 100`, rather than in a config file an agent can edit.

## Commit Trailers

| Trailer | Written by | Meaning |
| --- | --- | --- |
| `Spec-Approved: <change>` | The skill, after human approval | The commit that freezes the rules |
| `Red-For: <group>` | The test writer | Failing tests for a group |
| `Test-Fix-For: <group>` | The main session, after a human agrees a test is wrong | A test-only fix after red |
| `Green-For: <group>` | `gate task` | The group passed |
| `No-Test: <reason>` | `gate task` | The group had no tests of its own |

Write trailers with `git commit --trailer`, so they share one block with any other trailers.

## Group Kinds

Set in the `tasks.md` heading, for example `## 3. Update docs (no-test)`.

| Kind | Red step | Test edits |
| --- | --- | --- |
| `code` (default) | Yes | Only in the test writer's commit, or a `Test-Fix-For` commit |
| `no-test` | No | Allowed and not checked; verify commands still run. Use it for docs, wiring, config, and tests that pass on today's code, such as mutation-killing tests. `gate final` rejects this kind unless the approved heading says so |
| `refactor` | No | None allowed, so behaviour is pinned by existing tests |

A test that a human agrees is wrong is fixed with `Test-Fix-For` and `gate test-fix` in a `code` group only. A `no-test` or `refactor` group has no red step, so the fix is a plain commit, and the group is delivered again as `no-test`.

### Gate command

A `Gate: <command>` line under a group heading gives the group its own proof:

```
## 3. Kill auth mutants (no-test)

Gate: scripts/mutation.sh --mutate "**/Auth/*.cs" --break-at 100

- [ ] 3.1 Add tests until every mutant is killed
```

`gate task --change` reads the line from the approved `tasks.md`, runs it after the verify commands, and keeps its output in `spec-deliver/<group>.evidence.log` under `git rev-parse --absolute-git-dir`. `gate final` does not run it again, because it can be slow. It checks that the command passed at the commit the group was accepted at.

## Stacks

- **Compiled languages**: a test referencing a missing symbol fails to compile, which says nothing about behaviour. The test writer commits signature stubs so the failure is an assertion.
- **Pre-commit hooks**: hooks may reject failing tests, so `--no-verify` is allowed on red commits only.
- **Slow suites**: `gate red` runs the full `test` command once per group, and `gate task` runs the verify commands and the group's `Gate:` command. A gate call must finish inside the Bash tool's maximum timeout of 10 minutes, so point `test` at something faster if the suite takes longer, and scope a `Gate:` command to the group's files.

## State File

`.config/spec-deliver/state.local.md` tracks progress:

```yaml
---
change: add-user-auth
branch: spec/add-user-auth
phase: delivering       # exploring | proposing | reviewing | delivering | qa | verifying | archiving
tier: standard          # quick | standard | high-risk
signoff: false
source: plans/auth.md   # the plan file the idea came from, if any
source_sha: 9f2c…       # git hash-object of that file, checked again before approval
approved_sha: 1a2b3c4
started: 2026-11-06
updated: 2026-11-06
---

Original idea text here
```

## Resume

Run `/spec-deliver:spec-deliver` again. It reads the state file and reconciles it with disk. Inside delivery, `gate status` reports each group's state, so finished groups are skipped and a group left at red continues with its implementer.

The gate's records live in `.git/spec-deliver/`, so a delivery belongs to one clone. In a fresh clone, `gate final` reports `red-not-checked` or `evidence-not-checked` because the proof that red failed, or that a `Gate:` command passed, is gone. Finish on the original clone, or have the engineer accept the gap in the evidence pack.

## Done Means

1. `gate final` passes, run from the main session
2. The conformance review marks every spec scenario met, or the gap is accepted in the evidence pack
3. The review covered every file, and Critical and High findings are fixed or explicitly deferred
4. A human has reviewed and merged the PR
