---
description: "Initialize a project for spec-driven delivery: OpenSpec, verify commands, permissions and the CI check"
argument-hint: "[--tech-stack \"TypeScript, C#\"]"
---

# Spec Deliver: Init

Bootstrap a project for spec-driven delivery.

## Steps

1. **Parse arguments** from `$ARGUMENTS`. Look for `--tech-stack "<value>"` (or `-s "<value>"`). If it is not provided, detect it in step 3.

2. **Check prerequisites**:

   a. Verify OpenSpec is installed:
   ```bash
   command -v openspec && openspec --version
   ```
   If not found, say:
   > OpenSpec is not installed. Run the device setup first:
   > ```bash
   > bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"
   > ```
   Then stop.

   b. Check if already initialized:
   ```bash
   test -d openspec && echo "EXISTS" || echo "NOT_FOUND"
   ```
   If EXISTS, ask: "This project already has OpenSpec. Re-run init? This rewrites `openspec/config.yaml` and the CI check, and keeps specs, changes, schemas and an existing verify file." If the user declines, stop.

3. **Detect the tech stack** (if `--tech-stack` was not provided):

   - `package.json`, `tsconfig.json`: TypeScript
   - `*.csproj`, `*.sln`: C#
   - `go.mod`: Go
   - `Cargo.toml`: Rust
   - `requirements.txt`, `pyproject.toml`: Python
   - `Gemfile`: Ruby

   Present the result and use AskUserQuestion to let the user confirm or adjust it.

4. **Initialize OpenSpec**:
   ```bash
   openspec init --tools claude --profile core
   ```

5. **Create the OpenSpec config**. Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/openspec-config.yaml`, replace `{{TECH_STACK}}`, and write the result to `openspec/config.yaml`.

   This uses the stock `spec-driven` schema. If `openspec/schemas/spec-driven-tracey/` exists, leave it: changes pinned to it fail without it. See `${CLAUDE_PLUGIN_ROOT}/docs/MIGRATION.md`.

6. **Create the verify file**, unless `.config/spec-deliver/verify` already exists. These commands define done for every delivery, so they must be concrete.

   Detect them from `package.json` scripts, `Makefile`, `pyproject.toml`, and CI config under `.github/workflows/`. Then use AskUserQuestion to confirm them. Write one `label: command` per line:

   ```
   # What "done" means. spec-deliver reads this from the approved commit.
   test: npm test
   lint: npm run lint
   build: npm run build
   ```

   `test` should be the fastest command that runs the whole suite. If the repo has no tests, leave out `test` and mark every group `(no-test)`.

7. **Add permissions**. Unattended agents need allow rules, and plugins cannot ship permissions. Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/claude-settings.json` and merge it into `.claude/settings.json`: append to the `permissions` lists and leave every other key and existing rule alone.

   Also add one `Bash(<command>:*)` allow rule per verify command, for example `Bash(npm test:*)`.

   Show the user the rules you added. `git push` is an `ask` rule on purpose: a human confirms every push, and background agents cannot push.

8. **Ignore local state**. Add this line to `.gitignore` if it is not already covered:
   ```
   .claude/*.local.*
   ```

9. **Install the CI check**:

   ```bash
   mkdir -p .github/workflows
   ```

   Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/spec-validation.yaml` and write it verbatim to `.github/workflows/spec-validation.yaml`. It runs `openspec validate --all --strict` on every PR and on pushes to main. Run the repo's verify commands in CI too, because consumer CI backs up the gate.

10. **Verify setup**:
    ```bash
    openspec schema which spec-driven
    spec-deliver-gate baseline --approved HEAD
    ```
    The gate call is expected to report `not-approved`, which proves it is on `PATH`. Any other error needs fixing.

11. **Display a summary**:

    ```
    ## Project initialized for spec-driven delivery

    **OpenSpec**: stock spec-driven schema
    **Tech stack**: {detected stack}
    **Verify commands**: {labels}

    ### Created or updated
    - openspec/config.yaml
    - .config/spec-deliver/verify
    - .claude/settings.json
    - .gitignore
    - .github/workflows/spec-validation.yaml

    ### Before your first delivery
    - Commit these files.
    - Open this repo interactively once and accept the trust dialog. Allow rules are ignored in untrusted workspaces.
    - Protect the default branch.

    ### Next
    Run `/spec-deliver:spec-deliver "your idea"`, or add `--quick` for a small fix.
    ```
