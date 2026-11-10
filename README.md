# Spec Deliver

Spec-driven delivery for Claude Code: **idea → short spec → human approval → test-first delivery → review → PR**.

You approve what gets built. Agents build it group by group, and a deterministic gate decides when it is done, not the agent doing the work.

## What It Does

1. **Explores** the idea with you
2. **Writes a short spec** with OpenSpec
3. **Pauses for your approval**, recorded in a commit that freezes the rules
4. **Delivers each task group** in fresh context: failing tests first, then the code, then the gate, then a review
5. **Reviews** through specialist lenses, checking each finding against the code
6. **Runs the final gate** and writes an evidence pack
7. **Archives the spec and opens a PR** for a human to review and merge

## Prerequisites

- [Claude Code](https://claude.com/claude-code) with dynamic workflows enabled
- Node.js 20.19+

## Installation

### Once per device

```bash
# 1. Add the repo as a plugin marketplace
/plugin marketplace add chrisbruford/spec-deliver

# 2. Install the plugin
/plugin install spec-deliver@spec-deliver --scope user

# 3. Install OpenSpec. Ask Claude to "run the spec-deliver setup script", or run:
bash ~/.claude/plugins/cache/spec-deliver/spec-deliver/<version>/scripts/setup.sh
```

The setup script sets npm's global prefix to `~/.npm-global` and adds it to your shell profiles. Read it first if you manage Node with a version manager.

### Once per repo

```
/spec-deliver:init
```

This creates `openspec/`, the verify file that defines done, the permissions delivery needs in your personal `.claude/settings.local.json`, and a CI check. Commit the result, and open the repo interactively once to accept the trust dialog, because allow rules are ignored in untrusted workspaces.

If your team does not want spec-deliver files in the repo, choose local mode. Init excludes the tooling in `.git/info/exclude`, and each PR is opened from a clean branch that holds only the delivered change.

To enable the plugin for all contributors, add this to the repo's `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "spec-deliver@spec-deliver": true
  }
}
```

## Usage

| Command | Use for |
| --- | --- |
| `/spec-deliver:spec-deliver "add JWT auth"` | A feature, from idea to PR |
| `/spec-deliver:spec-deliver "fix rounding bug" --quick` | A bug fix or small change: acceptance tests, no spec documents |
| `/spec-deliver:spec-deliver "move card vault" --high-risk` | Auth, payments, migrations: full design |
| `/spec-deliver:spec-deliver "move card vault" --signoff` | Sign off each group before the next one starts |
| `/spec-deliver:spec-deliver add-jwt-auth --skip-explore` | Skip straight to the spec |
| `/spec-deliver:parallel-review [base]` | Review any branch, standalone |
| `/spec-deliver:help` | Show help |

If a run is interrupted, run `/spec-deliver:spec-deliver` again. It resumes from the state file and commits.

## How It Works

See the [workflow reference](skills/spec-deliver/references/workflow.md) for the flow, gate modes, the verify file and commit trailers.

### The gate

`spec-deliver-gate` is a script, so it cannot be talked round. Its rules come from `.config/spec-deliver/verify` as it stood at the approved commit:

```
test: npm test
lint: npm run lint
```

It checks that new tests fail first, that tests, specs, CI and test runner config stay untouched between red and green, and that the verify commands pass. An agent with a shell could still forge the gate's local records, so consumer CI and human review remain the backstop.

### Review

`parallel-review` always runs the qa, adversarial, security and tests lenses. It adds concurrency, observability, contract and ops when the diff warrants them, and reports what it skipped and why. Each Critical, High and Medium finding then goes to a verifier that tries to refute it against the code.

Findings go to at most 6 verifiers, with findings from one file kept together.

If you have the [ponytail](https://github.com/DietrichGebert/ponytail) plugin, the selector can add it as a lens when the diff adds code that may be simpler. Its SubagentStart hook injects its rules into every sub-agent, which can work against the reviewers' exhaustiveness mandate. To keep them out, add this to the `env` block of `~/.claude/settings.json`:

```json
"PONYTAIL_SUBAGENT_MATCHER": "^(?!(spec-deliver:)?(qa-code|adversarial|security|concurrency|observability|contract|ops|tests)-reviewer$)"
```

### Why each stage exists

Every stage covers a model weakness. Re-test this list on each model release, and delete what no longer earns its cost.

| Stage | Weakness it covers | Remove it when |
| --- | --- | --- |
| Human approval | Agents build the wrong thing confidently | Never: this is the accountability point |
| Separate test writer | Agents shape tests around their own code | Implementers stop weakening tests |
| Gate on test edits | Agents edit tests to pass | Reward hacking stops showing up in evals |
| Fresh context per group | Long sessions drift, and compaction can drop specs | Long-session quality matches fresh context in evals |
| Group reviewer | Green tests can still be vacuous | Evals show it finds nothing the final review misses |
| Finding verification | Reviewers report plausible false positives | False positive rates fall low enough to skip it |
| Multiple lenses | One reviewer misses whole categories | One strong reviewer matches them in evals |

## Unattended Runs

Before leaving delivery to run:

- **What done means**: review `.config/spec-deliver/verify`. It is frozen at approval.
- **What it may touch**: enable [sandboxing](https://code.claude.com/docs/en/sandboxing) with a network allowlist. It covers shell commands only.
- **Secrets**: keep credentials out of the environment and out of reach. A sandbox with mounted credentials is still an exfiltration path.
- **What stops it**: the workflow stops after 2 retries per group, and caps agents. Pass `--max-output-tokens` to cap spend too.
- **Who signs off**: protect the default branch and require human review. `git push` is an `ask` rule, so background agents cannot push.
- **Untrusted input**: treat issue and PR text as data. Don't paste it into a spec unread.
- **Plugins**: pin the versions you install, and read a plugin's hooks and scripts before enabling it. This one ships no hooks.

## Development

```bash
bash tests/skill-lint.sh               # regression checks on skill text
node --test tests/*.test.mjs           # workflow control flow, with fake agents
bash tests/gate.test.sh                # gate behaviour against throwaway repos
claude plugin eval . --ablation none --no-publish --max-cost-usd 5
```

The last command is a local check, not part of CI. It runs real model calls through your Claude Code login, so no API key is needed. Run it before a release.

## License

MIT
