---
description: "Show help for the spec-deliver plugin"
---

Show the following help text:

```
# Spec Deliver — Spec-Driven Autonomous Delivery

Orchestrates OpenSpec + Tracey + Ralph loop for engineer-led, AI-executed delivery.

## Commands

  /spec-deliver:init                    Set up a project (OpenSpec + Tracey + custom schema)
  /spec-deliver:spec-deliver "<idea>"   Full workflow: explore → propose → review → deliver → verify → archive → PR
  /spec-deliver:spec-deliver <change> --skip-explore  Skip explore, go straight to propose
  /spec-deliver:ralph-deliver <change>  Launch Ralph loop only (standalone delivery)
  /spec-deliver:parallel-review [base]  8-agent parallel review (Phase 5 uses this; standalone-callable)
  /spec-deliver:help                    This help text

## Workflow

  1. /spec-deliver:spec-deliver "add user auth"  ← starts with interactive exploration
  2. Claude quizzes you about the idea           ← you answer questions
  3. Generates specs with Tracey markers         ← proposal, specs, design, tasks
  4. Presents specs for your review              ← QUALITY GATE: edit or approve
  5. Ralph loop delivers autonomously            ← TDD + Tracey annotations
  6. QA: parallel review + build                  ← QA GATE (/parallel-review fans out 8 specialist reviewers in parallel, including tests-reviewer which runs the suite)
  7. Verifies coverage + archives                ← tracey_status + opsx:verify
  8. Creates PR                                  ← with full traceability

## Resume

  If interrupted, run `/spec-deliver:spec-deliver` again — it detects the state file
  and resumes from where it left off.

## Prerequisites

  - OpenSpec CLI (installed via setup.sh)
  - Ralph loop plugin (/plugin install ralph-loop@claude-plugins-official)
  - Tracey MCP server (for coverage tracking)

## Device Setup

  First time on a new machine:
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"
```
