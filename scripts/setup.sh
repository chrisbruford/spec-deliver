#!/bin/bash
# spec-deliver: Device-level setup
# Installs OpenSpec globally and ensures PATH is configured.
# Run once per machine after installing the plugin.

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${BLUE}[spec-deliver]${NC} $1"; }
ok()    { echo -e "${GREEN}[spec-deliver]${NC} $1"; }
err()   { echo -e "${RED}[spec-deliver]${NC} $1" >&2; }

# Check Node.js
if ! command -v node &>/dev/null; then
  err "Node.js is required but not installed."
  err "Install Node.js 20+ from https://nodejs.org/"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js 20+ required, found v$(node --version)"
  exit 1
fi

info "Node.js $(node --version) detected"

# Set up npm global prefix in user space (avoids sudo)
NPM_GLOBAL="$HOME/.npm-global"
mkdir -p "$NPM_GLOBAL"
npm config set prefix "$NPM_GLOBAL"

# Ensure PATH includes npm-global
if [[ ":$PATH:" != *":$NPM_GLOBAL/bin:"* ]]; then
  export PATH="$NPM_GLOBAL/bin:$PATH"

  # Add to shell profiles if not already there
  for profile in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [ -f "$profile" ] && ! grep -q 'npm-global' "$profile" 2>/dev/null; then
      echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$profile"
      info "Added npm-global to PATH in $(basename "$profile")"
    fi
  done
fi

# Install or update OpenSpec
if command -v openspec &>/dev/null; then
  CURRENT=$(openspec --version 2>/dev/null || echo "unknown")
  info "OpenSpec $CURRENT already installed, checking for updates..."
  npm install -g @fission-ai/openspec 2>&1 | tail -1
else
  info "Installing OpenSpec..."
  npm install -g @fission-ai/openspec 2>&1 | tail -1
fi

OPENSPEC_VERSION=$(openspec --version 2>/dev/null || echo "unknown")
ok "OpenSpec $OPENSPEC_VERSION installed at $(which openspec)"

# Verify ralph-loop plugin is available
if [ -d "$HOME/.claude/plugins" ]; then
  RALPH_FOUND=$(find "$HOME/.claude/plugins" -name "ralph-loop" -type d 2>/dev/null | head -1)
  if [ -n "$RALPH_FOUND" ]; then
    ok "Ralph loop plugin found"
  else
    info "Ralph loop plugin not detected. Install it via: /plugin install ralph-loop@claude-plugins-official"
  fi
fi

# Verify Tracey MCP is available
if [ -f "$HOME/.claude/settings.json" ]; then
  if grep -q "tracey" "$HOME/.claude/settings.json" 2>/dev/null; then
    ok "Tracey MCP detected in settings"
  else
    info "Tracey MCP not detected in settings. Ensure it's configured as an MCP server."
  fi
fi

echo ""
ok "Device setup complete!"
echo ""
echo "Next steps:"
echo "  1. Open a project directory"
echo "  2. Run /spec-deliver:init to set up the project"
echo "  3. Run /spec-deliver \"your idea\" to start delivering"
