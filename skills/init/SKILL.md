---
description: "Initialize a project for spec-driven delivery: OpenSpec, verify commands, permissions and the CI check"
argument-hint: "[--tech-stack \"TypeScript, C#\"]"
---

# Spec Deliver: Init

Bootstrap a project for spec-driven delivery.

## Running commands

Run one command per Bash call, with no `;`, `&&` or pipes, because allow rules match single commands and worktree-isolated sessions refuse compound git commands. Use Read, Write and Glob for files, or `find` when Glob is not available.

## Steps

1. **Parse arguments** from `$ARGUMENTS`. Look for `--tech-stack "<value>"` (or `-s "<value>"`). If it is not provided, detect it in step 3.

2. **Check prerequisites**:

   a. Verify OpenSpec is installed:
   ```bash
   openspec --version
   ```
   If the command is not found, say:
   > OpenSpec is not installed. Run the device setup first:
   > ```bash
   > bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"
   > ```
   Then stop.

   b. Check if already initialized: use Glob on `openspec/config.yaml`. If it exists, ask: "This project already has OpenSpec. Re-run init? This rewrites `openspec/config.yaml` and the CI check, and keeps specs, changes, schemas and an existing verify file." If the user declines, stop.

3. **Detect the tech stack** (if `--tech-stack` was not provided):

   - `package.json`, `tsconfig.json`: TypeScript
   - `*.csproj`, `*.sln`: C#
   - `go.mod`: Go
   - `Cargo.toml`: Rust
   - `requirements.txt`, `pyproject.toml`: Python
   - `Gemfile`: Ruby

   Present the result and use AskUserQuestion to let the user confirm or adjust it.

3a. **Ask where the tooling lives**, with AskUserQuestion: commit the spec-deliver and OpenSpec files to the repo for the whole team, or keep them local to this clone. Some teams do not want them in the repo.

    For local, add these lines to `.git/info/exclude` and skip step 9. Deliveries still commit the spec and verify file on the change branch, because the gate reads them from commits, and the PR is opened from a clean branch.

    ```
    openspec/
    .config/spec-deliver/
    .claude/skills/openspec-*/
    .claude/commands/opsx/
    ```

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

   If a command runs a script in this repo, add a `protect:` line covering it, because the gate protects the verify file but not the scripts it calls. `protect:` replaces the default list, so copy the defaults from `bin/spec-deliver-gate` into it.

   `test` should be the fastest command that runs the whole suite. If the repo has no tests, suggest a way to add them before you give up on `test`: for Terraform, `terraform test` with `mock_provider` blocks runs without cloud credentials. Only if the user declines, leave out `test` and mark every group `(no-test)`.

   If a plan will need to edit a protected path, such as a deploy workflow, an `allow: <regex>` line exempts exactly those paths and keeps the other defaults. spec-deliver suggests one before each approval, so init does not need one.

7. **Add permissions**. Unattended agents need allow rules, and plugins cannot ship permissions. Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/claude-settings.json` and merge it into `.claude/settings.local.json`: append to the `permissions` lists and leave every other key and existing rule alone.

   These rules give agents write access without a prompt, so they go in your personal settings, not the team's `.claude/settings.json`. Run `git check-ignore -q .claude/settings.local.json`. If it is not ignored, add it to `.gitignore`, or to `.git/info/exclude` in local mode.

   Also add one `Bash(<command>:*)` allow rule per verify command, for example `Bash(npm test:*)`.

   Show the user the rules you added. `git push` is an `ask` rule on purpose: a human confirms every push, and background agents cannot push. Auto mode may block writing settings files: if it does, show the user the rules and ask them to approve the write.

8. **Ignore local state**. Add this line to `.gitignore` if it is not already covered:
   ```
   .config/spec-deliver/*.local.*
   ```

9. **Install the CI check**:

   ```bash
   mkdir -p .github/workflows
   ```

   Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/spec-validation.yaml` and write it verbatim to `.github/workflows/spec-validation.yaml`. It runs `openspec validate --all --strict` on every PR and on pushes to main. Run the repo's verify commands in CI too, because consumer CI backs up the gate.

10. **Verify setup**, one command at a time:
    ```bash
    openspec schema which spec-driven
    ```
    ```bash
    spec-deliver-gate preflight
    ```
    The gate runs every verify command on the current tree and must end with `GATE preflight PASS`. Every delivery starts from this baseline, so if a command fails on existing code, such as formatting drift, show the user and offer to fix it now.

11. **Display a summary**:

    ```
    ## Project initialized for spec-driven delivery

    **OpenSpec**: stock spec-driven schema
    **Tech stack**: {detected stack}
    **Verify commands**: {labels}

    ### Created or updated
    - openspec/config.yaml
    - .claude/skills/openspec-* and .claude/commands/opsx/ (from openspec init)
    - .config/spec-deliver/verify
    - .claude/settings.local.json (personal, not committed)
    - .gitignore
    - .github/workflows/spec-validation.yaml (not in local mode)

    ### Before your first delivery
    - Commit all of these, unless you chose local mode. Delivery needs a clean tree.
    - Open this repo interactively once and accept the trust dialog. Allow rules are ignored in untrusted workspaces.
    - Protect the default branch.

    ### Next
    Run `/spec-deliver:spec-deliver "your idea"`, or add `--quick` for a small fix.
    ```
