---
name: spec-deliver
description: Orchestrate spec-driven autonomous delivery using OpenSpec, Tracey traceability, and Ralph loop. Use when the user wants to build a feature from an idea through to a PR with full requirement traceability. Detects when a project has openspec/ and .config/tracey/ directories.
license: MIT
metadata:
  author: spec-deliver
  version: "1.0"
---

# Spec Deliver

Spec-driven autonomous delivery: idea → specs → code → PR with full traceability.

## When to Use

Use this skill when:
- User describes a feature or change they want to build
- Project has `openspec/` directory and `.config/tracey/config.styx`
- User asks about "spec-driven delivery" or "autonomous delivery"
- User wants to generate specs with traceability and then implement them

## Overview

This plugin orchestrates three tools into a single workflow:

1. **OpenSpec** — Generates structured specs (proposal, requirements, design, tasks) from high-level ideas via interactive exploration
2. **Tracey** — Links specs to code via `r[impl req.id]` and `r[verify req.id]` annotations, tracks coverage
3. **Ralph Loop** — Autonomous coding loop that implements tasks until all Tracey requirements are covered

## Commands

- `/spec-deliver:init` — Bootstrap a project with OpenSpec + Tracey + custom schema
- `/spec-deliver "idea"` — Full orchestrated workflow with human checkpoints
- `/ralph-deliver change-name` — Standalone Ralph loop delivery from existing specs
- `/spec-deliver:help` — Show help

## Workflow Phases

```
Explore (interactive) → Propose (automated) → Review (human gate)
    → Deliver (Ralph loop) → Verify (automated) → Archive → PR
```

The orchestrator saves state to `.claude/spec-deliver.local.md` and can resume
after interruption by re-running `/spec-deliver`.
