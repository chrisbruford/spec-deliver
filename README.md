# Spec Deliver

Spec-driven autonomous delivery for Claude Code. Orchestrates OpenSpec, Tracey, and Ralph loop into a single workflow: **idea → specs → code → PR** with full requirement traceability.

## What It Does

You describe what you want to build. The plugin:

1. **Explores** the idea with you through interactive Q&A
2. **Generates specs** with Tracey requirement markers (`r[capability.requirement]`)
3. **Pauses for your review** — you're the architect, this is the quality gate
4. **Delivers autonomously** via Ralph loop with TDD and Tracey annotations
5. **Verifies** coverage and spec compliance
6. **Archives** and creates a PR

## Prerequisites

- [Claude Code](https://claude.com/claude-code) with plugin support
- [Ralph Loop plugin](https://github.com/anthropics/claude-plugins-official) — `ralph-loop@claude-plugins-official`
- [Tracey](https://github.com/bearcove/tracey) MCP server configured
- Node.js 20+

## Installation

### First-time setup (once per device)

```bash
# 1. Add the repo as a plugin marketplace
/plugin marketplace add chrisbruford/spec-deliver

# 2. Install the plugin (user scope = available in all projects)
/plugin install spec-deliver --scope user

# 3. Install OpenSpec and verify dependencies
# In Claude Code, ask: "run the spec-deliver setup script"
# Or manually:
bash ~/.claude/plugins/cache/spec-deliver/spec-deliver/scripts/setup.sh
```

### Also required

```bash
# Install the Ralph Loop plugin (if not already installed)
/plugin install ralph-loop@claude-plugins-official --scope user
```

### Per-project setup (for team repos)

Add to your project's `.claude/settings.json` so the plugin is enabled for all contributors:

```json
{
  "enabledPlugins": {
    "spec-deliver@spec-deliver": true
  }
}
```

### Project bootstrap

In each repo, run once:

```
/spec-deliver:init
```

This detects your tech stack and creates:
- `openspec/` — OpenSpec directory with the Tracey-integrated schema
- `openspec/config.yaml` — Project context and Tracey rules
- `.config/tracey/config.styx` — Tracey configuration pointing at specs

## Usage

### Full Workflow (recommended)

```
/spec-deliver "add JWT authentication with refresh tokens"
```

### Skip Exploration

```
/spec-deliver add-jwt-auth --skip-explore
```

### Standalone Delivery

If you've already created specs via `/opsx:propose`:

```
/ralph-deliver add-jwt-auth --max-iterations 50
```

### Resume After Interruption

Just run `/spec-deliver` again — it detects the state file and resumes.

## Commands

| Command | Description |
|---|---|
| `/spec-deliver:init` | Bootstrap project with OpenSpec + Tracey |
| `/spec-deliver "<idea>"` | Full orchestrated workflow |
| `/ralph-deliver <change>` | Standalone Ralph loop delivery |
| `/spec-deliver:help` | Show help |

## How It Works

### The Custom Schema

The plugin ships a forked OpenSpec schema (`spec-driven-tracey`) that modifies the default `spec-driven` schema to:

- Inject Tracey `r[capability.requirement-name]` markers into every spec requirement
- Add Tracey ID references to every task in the task list
- Include Tracey annotation instructions in the apply/delivery phase

### Tracey Integration

Specs contain requirement markers:
```markdown
### Requirement: User can export data
> r[data-export.user-can-export-data]
The system SHALL allow users to export their data in CSV format.
```

Code gets annotated during delivery:
```typescript
// r[impl data-export.user-can-export-data]
export function exportUserData(userId: string): CsvFile { ... }

// r[verify data-export.user-can-export-data]
test('exports user data as CSV', () => { ... });
```

### Ralph Loop Delivery

The Ralph loop prompt is assembled from all OpenSpec artifacts with:
- Tracey annotation instructions
- TDD cycle enforcement
- Completion criteria tied to Tracey coverage (all requirements must have `impl` and `verify` references)

## File Structure

```
your-project/
├── openspec/
│   ├── config.yaml                          # Project context + Tracey rules
│   ├── schemas/spec-driven-tracey/          # Custom schema with Tracey integration
│   │   ├── schema.yaml
│   │   └── templates/
│   ├── specs/                               # Stable specs (accumulated over time)
│   └── changes/                             # Active changes
│       └── <change-name>/
│           ├── proposal.md
│           ├── specs/<capability>/spec.md   # With r[...] markers
│           ├── design.md
│           └── tasks.md                     # With r[...] IDs per task
├── .config/tracey/config.styx               # Tracey configuration
└── .claude/
    └── spec-deliver.local.md                # Orchestrator state (temporary)
```

## Philosophy

- **Specs are the stable artifact, code is derived.** Spend your time reviewing specs.
- **Engineer-led, AI-executed.** You make the design decisions; Ralph does the typing.
- **Traceability by default.** Every line of code links back to a requirement.
- **Resumable.** Interruptions are expected. State persists on disk.

## License

MIT
