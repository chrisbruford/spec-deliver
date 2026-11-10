---
description: "Show help for the spec-deliver plugin"
---

Show the following help text:

```
# Spec Deliver: Spec-Driven Delivery

Short specs, human approval, test-first delivery checked by a deterministic gate.

## Commands

  /spec-deliver:init                             Set up a project
  /spec-deliver:spec-deliver "<idea>"            Full flow, from idea to PR
  /spec-deliver:spec-deliver "<fix>" --quick     Small change: acceptance tests only
  /spec-deliver:spec-deliver "<idea>" --high-risk  Full design
  /spec-deliver:spec-deliver "<idea>" --signoff    Sign off each group
  /spec-deliver:spec-deliver <change> --skip-explore  Go straight to propose
  /spec-deliver:parallel-review [base]           Multi-lens review, also standalone
  /spec-deliver:help                             This help text

## Workflow

  1. Explore the idea with you
  2. Write a short spec                ← proposal, spec, design, tasks
  3. You approve it                    ← QUALITY GATE, recorded in a commit
  4. Deliver group by group            ← failing tests, code, review, gate
  5. Specialist review, then triage    ← QA GATE
  6. Final gate and evidence pack      ← spec-deliver-gate final
  7. Archive the spec
  8. Open a PR                         ← a human reviews and merges

## Resume

  If interrupted, run /spec-deliver:spec-deliver again. It picks up from the
  state file and commits.

## Prerequisites

  - Claude Code with dynamic workflows enabled
  - OpenSpec CLI (installed by setup.sh)

## Device Setup

  First time on a new machine:
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"
```
