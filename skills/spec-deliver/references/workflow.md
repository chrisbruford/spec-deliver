# Spec Deliver Workflow Reference

## End-to-End Flow

```
/spec-deliver:spec-deliver "description"
    │
    ├─ Branch: never on the default branch
    ├─ 1 EXPLORE: /opsx:explore, interactive
    ├─ 2 PROPOSE: /opsx:propose writes proposal, spec, design, tasks
    ├─ 3 APPROVE ← HUMAN GATE
    │   └─ commit with a Spec-Approved trailer freezes specs and verify commands
    │
    ├─ 4 DELIVER: workflow spec-deliver:deliver, per task group
    │   ├─ test-writer commits failing tests     (Red-For: <group>)
    │   ├─ gate red: tests must fail
    │   ├─ implementer, fresh context
    │   ├─ gate task: verify commands pass, tests and protected paths untouched
    │   │   └─ up to 2 forward-only retries, then stop and report
    │   ├─ reviewer reads the diff and the red log
    │   └─ gate accept: ticks tasks.md, commits  (Green-For: <group>)
    │
    ├─ 5 QA: workflow spec-deliver:review
    │   └─ lenses chosen by diff, verify each finding, dedup, rank, report file
    ├─ 6 VERIFY: gate final from the main session, then the evidence pack
    ├─ 7 ARCHIVE: /opsx:archive, commit
    └─ 8 PR: evidence pack in the body ← HUMAN GATE
```

`--quick` skips Explore, Propose and Archive. `--high-risk` runs one workflow per group, with human sign-off between groups.

## The Gate

`spec-deliver-gate` lives in the plugin's `bin/`, so it is on `PATH` whenever the plugin is enabled. It is the only definition of done. No agent's claim counts until the gate says so.

| Mode | Checks |
| --- | --- |
| `baseline` | Clean tree, verify commands pass |
| `status` | Reports `none`, `red-unchecked`, `red` or `green` for a group |
| `red` | HEAD is the group's `Red-For` commit, it touches a test file, and the test command fails |
| `task` | Clean tree, protected paths intact, no test edits since red, verify commands pass |
| `accept` | `task` passed at this exact HEAD; ticks the group and commits `Green-For` |
| `final` | All of the above across every group, every task ticked, verify commands pass |

The last line of output is always `GATE <mode> <PASS|FAIL|ERROR> ...`. Exit codes are 0 pass, 1 fail, 2 usage or configuration error.

### Trust model

The gate holds honest agents to account. It is not tamper-proof, because an agent with a shell can forge local records in `.git/spec-deliver/`. The real controls are the main session rerunning `gate final`, consumer CI, and human review of the PR.

The gate catches edited tests, not vacuous ones. Only the group reviewer and human review catch a test that proves nothing.

## The Verify File

`.config/spec-deliver/verify` is committed, and the gate reads it from the approved commit, so changes during delivery have no effect.

```
# label: command
test: npm test
lint: npm run lint
build: npm run build
```

Every `label: command` line runs. `test` is the command `gate red` expects to fail. Two keys are reserved:

| Key | Purpose |
| --- | --- |
| `test-files: <regex>` | Replaces the default pattern for what counts as a test file |
| `protect: <regex>` | Replaces the default protected paths |

The defaults protect the verify file, CI workflows, Claude settings, stable specs, the change's spec, proposal and design, and common test runner config. If a change must edit a protected path, set `protect:` before approval.

## Commit Trailers

| Trailer | Written by | Meaning |
| --- | --- | --- |
| `Spec-Approved: <change>` | The skill, after human approval | The commit that freezes the rules |
| `Red-For: <group>` | The test writer | Failing tests for a group |
| `Green-For: <group>` | `gate accept` | The group passed |
| `No-Test: <reason>` | `gate accept` | The group had no tests of its own |

## Group Kinds

Set in the `tasks.md` heading, for example `## 3. Update docs (no-test)`.

| Kind | Red step | Test edits |
| --- | --- | --- |
| `code` (default) | Yes | Only in the test writer's commit |
| `no-test` | No | Not checked; verify commands still run |
| `refactor` | No | None allowed, so behaviour is pinned by existing tests |

## Stacks

- **Compiled languages**: a test referencing a missing symbol fails to compile, which says nothing about behaviour. The test writer commits signature stubs so the failure is an assertion.
- **Pre-commit hooks**: hooks may reject failing tests, so `--no-verify` is allowed on red commits only.
- **Slow suites**: `gate red` runs the full `test` command once per group.

## State File

`.claude/spec-deliver.local.md` tracks progress:

```yaml
---
change: add-user-auth
branch: spec/add-user-auth
phase: delivering       # exploring | proposing | reviewing | delivering | qa | verifying | archiving
tier: standard          # quick | standard | high-risk
approved_sha: 1a2b3c4
started: 2026-11-06
updated: 2026-11-06
---

Original idea text here
```

## Resume

Run `/spec-deliver:spec-deliver` again. It reads the state file and reconciles it with disk. Inside delivery, resume comes from commits and `tasks.md`: `gate status` reports each group's state, so finished groups are skipped and a group left at red continues with its implementer.

## Done Means

1. `gate final` passes, run from the main session
2. Every spec scenario maps to a named test, or the gap is accepted in the evidence pack
3. The review covered every file, and Critical and High findings are fixed or explicitly deferred
4. A human has reviewed and merged the PR
