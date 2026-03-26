---
description: "Initialize a project for spec-driven delivery with OpenSpec + Tracey"
argument-hint: "[--tech-stack \"TypeScript, C#\"]"
---

# Spec Deliver: Init

Bootstrap a project for spec-driven autonomous delivery. Sets up OpenSpec with the
Tracey-integrated custom schema and creates the Tracey configuration.

## Steps

1. **Parse arguments** from `$ARGUMENTS`:
   - Look for `--tech-stack "<value>"` (or `-s "<value>"`). Extract and remove it.
   - If not provided, it will be asked for later.

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
   If EXISTS, ask: "This project already has OpenSpec initialized. Do you want to re-run init? This will overwrite the schema and configs but preserve existing specs and changes."
   If user declines, stop.

3. **Detect project context** (if `--tech-stack` not provided):

   Analyze the project to infer the tech stack:
   - Check for `package.json`, `tsconfig.json` → TypeScript
   - Check for `*.csproj`, `*.sln` → C#
   - Check for `go.mod` → Go
   - Check for `Cargo.toml` → Rust
   - Check for `requirements.txt`, `pyproject.toml` → Python
   - Check for `Gemfile` → Ruby

   Present the detected stack and ask the user to confirm or adjust:
   > Detected tech stack: **TypeScript, C#**
   > Is this correct, or would you like to adjust?

   Use AskUserQuestion for this.

4. **Initialize OpenSpec**:
   ```bash
   openspec init --tools claude --profile core
   ```

5. **Install the custom schema**:

   Copy the Tracey-integrated schema from the plugin scaffolds:
   ```bash
   mkdir -p openspec/schemas/spec-driven-tracey/templates
   ```

   Then use the Write tool to copy each file from `${CLAUDE_PLUGIN_ROOT}/scaffolds/schema/` to `openspec/schemas/spec-driven-tracey/`:
   - Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/schema/schema.yaml` and write to `openspec/schemas/spec-driven-tracey/schema.yaml`
   - Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/schema/templates/proposal.md` and write to `openspec/schemas/spec-driven-tracey/templates/proposal.md`
   - Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/schema/templates/spec.md` and write to `openspec/schemas/spec-driven-tracey/templates/spec.md`
   - Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/schema/templates/design.md` and write to `openspec/schemas/spec-driven-tracey/templates/design.md`
   - Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/schema/templates/tasks.md` and write to `openspec/schemas/spec-driven-tracey/templates/tasks.md`

6. **Validate the schema**:
   ```bash
   openspec schema validate spec-driven-tracey
   ```
   If validation fails, report the error and stop.

7. **Create OpenSpec config**:

   Read `${CLAUDE_PLUGIN_ROOT}/scaffolds/openspec-config.yaml` as a template.
   Replace `{{TECH_STACK}}` with the detected/provided tech stack string.
   Write the result to `openspec/config.yaml`.

8. **Create Tracey config**:

   Create the directory:
   ```bash
   mkdir -p .config/tracey
   ```

   Build the Tracey config based on the detected tech stack. For each detected language,
   generate an `impl` block with appropriate include/exclude globs:

   **TypeScript**: `include (src/**/*.ts src/**/*.tsx)`, `exclude (node_modules/** dist/** build/**)`
   **C#**: `include (**/*.cs)`, `exclude (bin/** obj/** **/bin/** **/obj/**)`
   **Go**: `include (**/*.go)`, `exclude (vendor/**)`
   **Rust**: `include (crates/**/*.rs src/**/*.rs)`, `exclude (target/**)`
   **Python**: `include (**/*.py)`, `exclude (__pycache__/** .venv/** venv/**)`
   **Ruby**: `include (**/*.rb)`, `exclude (vendor/**)`

   Write the config to `.config/tracey/config.styx` using this structure:

   ```
   specs (
       {
           name openspec
           prefix r
           include (
               openspec/specs/**/*.md
               openspec/changes/*/specs/**/*.md
           )
           impls (
               {impl blocks for each detected language}
           )
       }
   )
   ```

9. **Verify setup**:
   ```bash
   openspec schema which spec-driven-tracey
   ```

10. **Display summary**:

    ```
    ## Project Initialized for Spec-Driven Delivery

    **OpenSpec**: Initialized with spec-driven-tracey schema
    **Tracey**: Configured at .config/tracey/config.styx
    **Tech stack**: {detected stack}
    **Implementations tracked**: {list of language impl names}

    ### Created files
    - openspec/config.yaml
    - openspec/schemas/spec-driven-tracey/ (schema + templates)
    - .config/tracey/config.styx

    ### Next steps
    - Run `/spec-deliver:spec-deliver "your idea"` to start your first feature
    - Or run `/opsx:explore "topic"` to investigate first
    ```
