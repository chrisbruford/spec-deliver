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
