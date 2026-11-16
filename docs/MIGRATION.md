# Migrating to 4.4

4.4 changes the PR body to describe the end state of the code, with diagrams. In-flight deliveries resume without changes.

| Before | After |
| --- | --- |
| The PR body was built from the evidence pack: gate result, scenario table, review verdict | The body describes the end state: Summary, How it fits together, Known limits, Action items, and a link to the evidence. The gate, scenarios and review stay in `evidence.md` |
| | `## How it fits together` holds Mermaid `flowchart`, `erDiagram` and `sequenceDiagram` blocks for the data flow, entities and multi-step paths the change adds, drawn from the code at HEAD |
| `--quick` and local mode put the evidence pack in the PR body | They post it as a PR comment. Add `Bash(gh pr comment:*)` to the `ask` list in `.claude/settings.local.json` |

# Migrating to 4.3

4.3 adds a check of the whole delivery against the whole change. In-flight deliveries resume without changes, and the conformance review runs when delivery ends.

| Before | After |
| --- | --- |
| Each check saw one slice: the group reviewer one group, the gate the process, the lenses the diff without the spec | The deliver workflow ends with a conformance review of `approved..HEAD` against the proposal, design, specs and constraints |
| Phase 6 matched scenarios to tests by name | The conformance review gives each scenario a verdict with evidence, and the evidence pack records it |
| The group reviewer saw only its own diff | It also checks the work so far against `design.md`, the constraints and earlier groups |
| `parallel-review --change` only set where the report goes | It also gives the qa and adversarial lenses the change's spec |
| | Testable conformance findings are fixed test-first in a `conf-<sha>` group. Findings no test can prove stop as `conformance-escalate` |

# Migrating to 4.2

4.2 fixes groups whose tests cannot fail first, found in a mutation-testing field run. In-flight deliveries resume without changes.

| Before | After |
| --- | --- |
| The implementer prompt banned test edits in `no-test` groups, which the gate never checked | `no-test` groups may add and edit tests. Test-file rules now depend on the kind, and the prompt claims only what the gate checks |
| A test-defect stop in a `no-test` or `refactor` group had no way through `gate test-fix` | Commit the agreed fix with no trailer, and deliver the group again as `no-test` |
| A `no-test` group's proof, such as a mutation score, was only the implementer's claim | A `Gate: <command>` line under the group heading, which `gate task` runs and `gate final` checks |
| The approval commit subject was `spec: approve <change>`, which Conventional Commits rejects | `chore(spec): approve <change>`. The gate still finds the approval by its trailer |

# Migrating to 4.1

4.1 changes the gate and the delivery workflow after the first field runs. In-flight deliveries resume without changes.

| Before | After |
| --- | --- |
| `gate task`, then the group review, then `gate accept` | The group review, then `gate task`, which ticks the group and commits `Green-For`. Auto mode blocked `accept` as self-approval |
| A wrong test after red needed a history rewrite | `Test-Fix-For` commit plus `gate test-fix`, forward only, after a human agrees |
| Editing a protected path meant replacing all of `protect:` | `allow: <regex>` exempts only those paths |
| Lock files in test projects counted as test edits | Generated lock files never count as tests |
| Any `Green-For` trailer marked a group green | `status` and `final` check that `task` wrote it |
| `--high-risk` meant sign-off per group and every review lens | `--signoff` asks for sign-off per group. Lens selection runs for every tier |
| The ponytail lens ran whenever the plugin was installed | The selector adds it when the diff warrants it |
| `init` wrote permissions to `.claude/settings.json` | `.claude/settings.local.json`, which is personal. Move the spec-deliver rules out of the shared file |
| Tooling had to be committed | `init` offers local mode |

Scripts that called `spec-deliver-gate accept` should call `task` with `--change`, and pass the no-test reason to `task --no-test <reason>`.

## Migrating to 4.0

4.0 removes the Ralph loop and Tracey, and replaces the forked OpenSpec schema with the stock one.

## What changed

| Before | After |
| --- | --- |
| `ralph-loop` plugin stops on a promise the model asserts | `spec-deliver:deliver` workflow, stopped by `spec-deliver-gate` |
| `/spec-deliver:ralph-deliver` | Removed. Rerun `/spec-deliver:spec-deliver <change>` |
| `/spec-deliver:tracey-health` | Removed |
| `--max-iterations` | Removed. The workflow has its own retry and agent limits |
| Forked `spec-driven-tracey` schema | Stock `spec-driven`, plus rules in `openspec/config.yaml` |
| `r[...]` requirement markers | Scenario-to-test table in `evidence.md` |
| `.claude/spec-deliver.local.md` | `.config/spec-deliver/state.local.md`, because `.claude/` is protected from unattended writes. Delete the old file |
| Experimental agent teams | Not needed. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` can go |

## Per repo

Work through repos one at a time, leaving the one with the most in-flight work until last.

1. Update the plugin to 4.0 and run `/spec-deliver:init`. It adds the verify file, permissions and a `.config/spec-deliver/*.local.*` ignore rule, and points `openspec/config.yaml` at the stock schema.
2. Commit the result, and open the repo interactively once to accept the trust dialog.
3. Finish in-flight changes. New changes use the stock schema. A change created earlier keeps its own schema setting.
4. **Keep `openspec/schemas/spec-driven-tracey/` until no change uses it.** OpenSpec throws on an unknown schema, so deleting it early breaks those changes. To check:

   ```bash
   grep -rl 'spec-driven-tracey' openspec/changes --include=.openspec.yaml --exclude-dir=archive
   ```

   When that prints nothing, delete the directory.

5. Remove Tracey: delete `.config/tracey/` and the Tracey steps in `.github/workflows/spec-validation.yaml`.
6. Existing `r[...]` markers in specs and code are harmless. Remove them when you next touch those files.

## In-flight changes

A change delivered under 3.x can finish under 4.0. Its `tasks.md` needs numbered `## <n>.` group headings, and any tasks that only write tests can stay. Approve it again so there is a `Spec-Approved` commit for the gate.

## Traceability

If a repo needs requirement-to-code links for audit, the `evidence.md` scenario table is weaker than Tracey: a reviewer checks it, rather than a tool. Tracey annotations can stay in that repo, but spec-deliver no longer maintains or checks them.
