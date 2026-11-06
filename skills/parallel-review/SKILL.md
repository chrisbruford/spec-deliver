---
description: "Multi-lens code review. Runs specialist reviewers in parallel (qa, adversarial, security, tests, plus concurrency, observability, contract and ops when the diff warrants them), checks every finding against the code, then dedups and ranks."
argument-hint: "[base] [--change <name>] [--all-lenses]"
---

# Parallel Review

Review pending changes with specialist lenses. The value is in the verification pass: each finding is checked against the code before you see it.

## Inputs

`/spec-deliver:parallel-review [base] [--change <name>] [--all-lenses]`

- `base` defaults to `main`. Prefer `origin/main` when local main may be stale.
- `--change <name>` writes the report into that OpenSpec change.
- `--all-lenses` runs all 8 lenses without selection. Use it for high-risk changes.

## Steps

### 1. Resolve the diff

Run these Bash commands:

- `git rev-parse --verify {base}`. If the base does not resolve, ask the user to clarify.
- `git rev-parse --abbrev-ref HEAD` gives `{branch}`.
- `git diff --stat {base}...HEAD`
- `git diff --name-only {base}...HEAD` gives `{files}`. If this is empty, say there is nothing to review and stop.

### 2. Size guard

Print `Reviewing {branch} → {base}: <N> files, +<X> / -<Y> lines.`

If the diff is over about 2,000 authored lines (excluding lockfiles) or 20 files, warn that review quality drops on large diffs and suggest splitting it. Do not abort.

### 3. Start the review

Call the Workflow tool with name `spec-deliver:review` and these `args`:

- `base`, `branch`, `files` (as an array), and `stats` (the diff summary line).
- `allLenses: true` if `--all-lenses` was passed.
- `ponytail: true` if the `ponytail:ponytail-review` skill is in your available skills list. Otherwise omit it, and do not suggest installing it.

Tell the user the review has started, then **end your turn**. The completion notification restarts you here.

### 4. Write the report

If the result's status is `refused`, report the reason and stop. Otherwise write the report to `openspec/changes/<change>/review.md` when `--change` was given, or to `.config/spec-deliver/review-<branch>.local.md` when it was not, replacing `/` with `-` in the branch name so the file stays git-ignored.

```markdown
# Review: {branch} → {base}

**Verdict:** <verdict>
**Lenses run:** <lensesRun>
**Lenses skipped:** <lens: reason, or "None">
**Refuted by verification:** <refuted>

## Test suite
<testSuite, or "Not run">

## Findings
<Grouped by severity. Each finding: title, lenses, file:line, evidence, scenario, impact, suggestion, and verification reason. Mark verified: false as "unverified".>

## Gaps
<failedLenses, uncoveredFiles and unverifiedOverCap, or "None">

## What's done well
<positives>
```

Show the user the verdict, finding counts, gaps and report path. `INCOMPLETE` means a lens failed, so the review cannot be called clean.

### 5. Close any gaps

Success is **coverage, not zero findings**, which is empirically unreachable with stochastic reviewers (arXiv:2509.01494). The pass is complete when every lens that ran returned, every file has a verdict, and the test suite was attempted.

If `failedLenses` or `uncoveredFiles` is not empty, rerun those lenses with the Agent tool using `spec-deliver:<lens>-reviewer`, or `spec-deliver:qa-code-reviewer` for `qa`. Never present a partial review as complete.

## Notes

- Reviewers are read-only. Acting on findings is a separate decision.
- Low and Info findings are not verified, to save cost. They are marked unverified.
- A finding the verifier could not rule on is kept and marked unverified.
