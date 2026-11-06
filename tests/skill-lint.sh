#!/usr/bin/env bash
# Regression checks for defects that live in skill text, where no runtime test can reach them.
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0
check() { # check <description> <command...>
  local desc=$1; shift
  if "$@" >/dev/null 2>&1; then echo "ok   - $desc"; else echo "FAIL - $desc"; fail=1; fi
}
absent() { ! grep -qE "$1" "$2"; }

S=skills/spec-deliver/SKILL.md
P=skills/parallel-review/SKILL.md

check "archive detection does not quote its glob" absent 'test -d "openspec/changes/archive/\*' "$S"
check "state file is not updated after it is deleted" absent 'Update state file.*phase: complete' "$S"
check "a branch is created before work starts" grep -q 'git switch -c' "$S"
check "--skip-explore still creates the branch and state file" grep -q 'skip only step 10' "$S"
check "delivery refuses to run on the default branch" grep -qi 'never.*default branch' "$S"
check "resume handles delivering with all tasks ticked" grep -qE '\| delivering +\| All tasks \[x\]' "$S"
check "QA fixes are committed" grep -qi 'commit the QA fixes' "$S"
check "archive output is committed" grep -qi 'commit the archive' "$S"
check "reviewer subagent types are plugin-prefixed" grep -q '`spec-deliver:qa-code-reviewer`' "$P"
check "every reviewer defines the shared severity scale" bash -c 'for f in agents/*-reviewer.md; do grep -q "^## Severity Scale" "$f" || exit 1; done'

# No retired dependency may survive outside the migration notes.
# init must still name the old schema, so that it can leave the directory in place.
check "no references to retired tools" bash -c '! grep -rnIiE "ralph|tracey|opsx:verify|agent team" . --exclude-dir=.git --exclude-dir=node_modules --exclude=MIGRATION.md --exclude=skill-lint.sh | grep -v "schemas/spec-driven-tracey"'
check "the approval commit carries the trailer the gate needs" grep -q 'Spec-Approved: <change-name>' "$S"
check "the skill ends its turn after starting the workflow" grep -q 'end your turn' "$S"
check "the final gate runs in the main session" grep -q 'Do not delegate it' "$S"
check "plugin manifest points at the new repo" grep -q 'chrisbruford/spec-deliver' .claude-plugin/plugin.json

exit $fail
