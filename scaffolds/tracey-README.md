# Tracey config — operator notes

Tracey tracks spec → code traceability for this repo. The config lives in `config.styx`. This README documents two structural quirks that look like "poor health" but are actually byproducts of Tracey's design — knowing about them up front saves rediscovery time later.

A CI check (`.github/workflows/spec-validation.yaml`) runs `openspec validate --all --strict` and `tracey query validate` on every PR. If either reports an error, the PR is blocked.

## Quick health check

```bash
tracey query status      # coverage overview by impl
tracey query validate    # 0 errors expected
```

When `tracey query validate` reports `Unique unknown rules`, fix them by either (a) adding the rule to the relevant spec, (b) renaming the code annotation to match an existing rule, or (c) — if the rule is meant to be created by an in-flight change — finishing and archiving that change via `openspec archive`.

## Known structural quirks

### 1. Terraform / HCL is NOT a supported parser language

Tracey supports `.rs .ts .js .go .c .cpp .py .rb .sh ...` but **not** `.tf` / HCL. If your repo has Terraform files with `# r[impl ...]` annotations, those annotations are valuable for human readers but **invisible to Tracey** — they don't contribute to coverage.

Do not attempt to add a `tf` impl block to `config.styx`. It produces `IncludeUnparseableFile` errors and reports 0 coverage. If you have Terraform-resident requirements, just accept that those rules will appear "uncovered" in `tracey query uncovered` and document the situation here.

### 2. The per-impl `<n> of <total>` coverage metric is misleading

Tracey reports coverage as `<covered> of <total>` **per impl**, against the SAME `<total>` for every impl. So if your `typescript` impl covers 200 of 250 rules (80%) and your `shell` impl covers 25 of 250 (10%), those are NOT two competing impls — the 225 rules "uncovered by shell" are uncovered because they're TypeScript-only by design, not because the shell impl is failing.

A rule is **truly uncovered** only when it has no `r[impl …]` reference in ANY impl. Use `tracey query rule <id>` to see the per-impl reference list for a specific rule.

## Adding a new rule

1. In the relevant `openspec/specs/<capability>/spec.md`, add a `### Requirement: <Name>` block under `## Requirements`. **The body order matters for `openspec validate --strict`**: write the SHALL/MUST body paragraph FIRST, then `> r[<capability>.<kebab-id>]` on a blockquote line BELOW it, then the `#### Scenario:` blocks. The openspec CLI's SHALL extractor reads the first non-blank line after `### Requirement:`; if that's `> r[id]` it reports a false-positive `must contain SHALL or MUST` error.

2. Add at least one `#### Scenario:` block.

3. Add `// r[impl <capability>.<kebab-id>]` at the implementation site (and `// r[verify ...]` in the test).

4. Run `tracey query validate` and `openspec validate --all --strict` locally before pushing — both are gated by CI on the PR.

If the rule's implementation is one line of Terraform, add the annotation to the `.tf` file anyway — it remains useful documentation even though Tracey can't see it. The rule will appear as "uncovered" in `tracey query uncovered` until/unless it also has a JS/TS/shell/Python/etc. implementation site to annotate.

## When openspec validate fails

The most common failure modes and their fixes:

- **`Requirement must contain SHALL or MUST keyword`** — the SHALL body is in the wrong place. Move it BEFORE the `> r[id]` line.
- **`Spec must have a Purpose section`** — the main spec is missing `# <Capability> Specification`, `## Purpose`, or `## Requirements` headers at the top.
- **`Main spec contains delta header "## ADDED Requirements"`** — you've used a change-delta header inside a main spec. Delta headers (`## ADDED/MODIFIED/REMOVED/RENAMED Requirements`) are only valid inside `openspec/changes/<name>/specs/<capability>/spec.md`.
- **`Requirement must have at least one scenario`** — add `#### Scenario:` blocks after the requirement body.
