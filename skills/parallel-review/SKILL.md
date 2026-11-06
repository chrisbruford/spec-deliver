---
description: "Exhaustive multi-agent code review. Fans out 8 specialist reviewers in parallel (qa, adversarial, security, concurrency, observability, contract, ops, tests) and aggregates findings."
---

# Parallel Review

Run an exhaustive review of pending changes by dispatching specialist reviewers in parallel and aggregating their findings. Each agent has a single lens, mandatory diff-walk loop, and mandatory final re-read pass — designed to catch findings in a single pass that traditionally require multiple iterative review passes.

## Inputs

Arguments format: `/parallel-review [base]` where `base` defaults to `main`. Examples:

- `/parallel-review` — review changes between HEAD and `main`
- `/parallel-review origin/main` — review against the remote main (preferred when local main is behind)
- `/parallel-review release/v2` — review against a release branch

If the user invoked the command with no argument, default `base=main`.

## Steps

### 1. Resolve diff base and size

Run these Bash commands (in parallel where independent):

- `git rev-parse --verify {base}` — confirm the base resolves; if it does not, ask the user to clarify.
- `git rev-parse --abbrev-ref HEAD` — capture current branch as `{branch}`.
- `git diff --stat {base}...HEAD | tail -1` — total insertions / deletions / files.
- `git diff --name-only {base}...HEAD` — full file list.
- `git log --oneline {base}..HEAD` — commit progression.

Compute approximate **authored line count**: insertions, minus any line attributable to lockfiles (`*lock*.json`, `*.lock`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`, `go.sum`, etc.) and minus mechanical renames (`.legacy` rename pattern, file moves with no content change).

### 2. Size guard

Print a one-line size summary to the user:

```
Reviewing {branch} → {base}: <N> files, +<X> / -<Y> lines (~<Z> authored).
```

If `authored_lines > 2000` or `files > 20`:

```
WARNING: this diff is large (~<Z> authored lines, <N> files). LLM review quality
empirically degrades past ~200k context tokens; this diff is likely to consume that.
Consider splitting before reviewing. Proceeding with parallel fan-out anyway.
```

Do not abort — the user already chose to run this command. The warning is so they can opt to cancel.

### 3. Fan-out

Dispatch **all eight** specialist reviewers **in a single message** with eight parallel Agent tool calls. The Agent tool's parallel dispatch is critical — sequential dispatch will exhaust context and time-budget before completing.

Each agent receives a prompt with this shape:

```
Review the diff between `{base}` and `HEAD` on branch `{branch}` in the current working directory `{cwd}`.

Total diff: <N> files, +<X> / -<Y>, ~<Z> authored lines.

Your scope: <lens-specific one-liner>.

Follow your prompt exactly. Apply the exhaustiveness mandate, the mandatory diff-walk loop, and the mandatory final re-read pass. Output in the format your prompt specifies. Findings only — do not modify code.
```

The eight agents and their `subagent_type` values:

| # | Agent | Lens one-liner |
|---|---|---|
| 1 | `spec-deliver:qa-code-reviewer` | General correctness, readability, idiomatic style, dead code, adherence to codebase patterns. |
| 2 | `spec-deliver:adversarial-reviewer` | Hostile-persona stress testing — attacker, confused user, grizzled veteran, chaos monkey, compliance auditor, pre-mortem analyst. |
| 3 | `spec-deliver:security-reviewer` | Auth, credentials, secrets, threat-model regressions, injection, SSRF, crypto correctness. |
| 4 | `spec-deliver:concurrency-reviewer` | Races, ordering, atomicity, crash windows, lock-step writes, replay/idempotency, async correctness. |
| 5 | `spec-deliver:observability-reviewer` | Log hygiene, metrics, traces, error context, on-call signal, runbook integration. |
| 6 | `spec-deliver:contract-reviewer` | API / wire-protocol back-compat, schema changes, env-var contracts, public exports, breaking changes. |
| 7 | `spec-deliver:ops-reviewer` | Deploy / rollback safety, migrations, feature flags, container / k8s / IaC, blast radius. |
| 8 | `spec-deliver:tests-reviewer` | Coverage of net-new code paths, real-bug-catching power, test isolation, mocking discipline. Also runs the test suite. |

Use the `Agent` tool with `subagent_type` set to each value above. **Send all eight in one message** — Claude Code parallelises Agent calls within a single message and serialises across messages.

#### Optional 9th lens: ponytail-review

If the `ponytail:ponytail-review` skill is in your available skills list (the user has installed the [ponytail](https://github.com/DietrichGebert/ponytail) plugin), add a ninth Agent call **in the same message**. If it is not listed, skip this lens silently — do not suggest installing it.

- `subagent_type`: `general-purpose`
- Lens: lean code — what should not exist or should be smaller (dead code, reuse an existing helper, stdlib/native instead of new code or a new dependency, YAGNI abstraction, near-copies to merge).
- Prompt:

  ```
  Invoke the Skill tool with skill `ponytail:ponytail-review` to review the diff between `{base}` and `HEAD` on branch `{branch}` in `{cwd}`. Findings only — do not modify code. Return the skill's full report.
  ```

When aggregating, map its groups onto the shared scale: **Must fix → HIGH**, **Should fix → MEDIUM**, **Nice to have → LOW**. Attribute its findings to `ponytail-review`, and carry its `Lean: -<N> lines possible.` line into the final report's Next steps.

### 4. Aggregate

When all dispatched agents return (eight, or nine with ponytail-review), you have one structured report per agent. Build a combined report by:

1. **Parse findings.** Each agent emits findings with: severity, file:line, lens, evidence, scenario, impact, suggestion.
2. **Deduplicate.** Two findings are duplicates if they reference the same file:line range AND describe substantively the same issue (similar evidence, similar scenario). When deduping:
   - Keep the higher severity.
   - Concatenate the agents' attribution (e.g. "found by: security-reviewer, adversarial-reviewer").
   - Keep the more specific suggestion.
3. **Sort.** By severity descending (CRITICAL → HIGH → MEDIUM → LOW → INFO), then by file path.
4. **Cross-reference coverage.** From each agent's coverage report, build a unified table: file → blocks reviewed by which agents → unreviewed blocks (if any).
5. **Capture test-suite result** from `tests-reviewer` separately.

### 5. Final report

Produce a single combined report in this shape:

```markdown
# Parallel Review — {branch} → {base}

**Diff:** <N> files, +<X> / -<Y> lines (~<Z> authored)
**Date:** <YYYY-MM-DD>
**Agents:** qa, adversarial, security, concurrency, observability, contract, ops, tests[, ponytail]
**Overall verdict:** [CLEAN | LOW | MEDIUM | HIGH | CRITICAL]

## Test suite
**Result:** <PASS X / FAIL Y / SKIPPED Z, duration> _(from tests-reviewer)_
<List failing tests if any, with one-line failure each.>

## Findings — Critical
<Each finding: title, lens(es), file:line, evidence, scenario, impact, suggestion.>

## Findings — High
...

## Findings — Medium
...

## Findings — Low
...

## Coverage map
<Table showing every file in the diff and which agents emitted a verdict on it.
 Flag any file no agent visited.>

## What's done well
<Aggregate of agents' positive observations, deduplicated.>

## Next steps
<Top 3-5 actions, sorted by severity-then-impact. State which are blocking
 and which are nice-to-have.>
```

### 6. Success criterion

This pass is **complete** when:

- All dispatched agents (8, or 9 with ponytail-review) returned without error.
- Every file in the diff has at least one verdict from at least one agent (check the coverage map — flag uncovered files for re-review).
- If documented threat-model docs exist in the repo, the adversarial and security reviewers both confirmed regression checks.
- The test suite was attempted (passing or failing both count — only "unable to run" requires a flag in the report).

This is **not** "zero criticals" — that target is empirically unreachable with stochastic reviewers (arXiv:2509.01494). The success criterion is *coverage*, not *cleanliness*. The user decides which findings to act on.

### 7. If a sub-agent fails

If any dispatched agent returns an error or empty report:

1. Do not silently drop it from the aggregation — flag it explicitly in the report:
   ```
   WARNING: {agent} did not complete successfully. Coverage gap in the {lens} lane.
   Consider re-running just that agent with: <Agent tool example>.
   ```
2. Continue producing the aggregate from the others. A partial report is better than nothing, but the user must know it is partial.

## Notes

- The agents are **read-only** by design — they cannot modify code. Acting on findings is a separate user decision and a separate session.
- This command is repo-agnostic. It reads the repo's own conventions, threat model docs, and runbooks. The only project-specific tuning happens inside the agents themselves via the docs they discover.
- For very large diffs (>5k authored lines), even parallel fan-out will struggle. Recommend a PR split in the size-guard warning rather than relying on iterative passes.
