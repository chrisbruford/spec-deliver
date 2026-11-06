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

# Found by reading the skills as a model would. Each of these dead-ended or corrupted a run.
I=skills/init/SKILL.md
C=scaffolds/claude-settings.json
check "the review report is committed before the clean-tree gate" grep -q 'always commit the review report' "$S"
check "the local report name cannot contain a slash" grep -qi 'replacing `/` with `-`' "$P"
check "resume returns to the change branch" grep -q 'git switch <branch>' "$S"
check "a different change does not resume an old state file" grep -qi 'names a different change' "$S"
check "resume without a valid approval goes back to Phase 3" grep -qi 'not an ancestor of HEAD' "$S"
check "quick resume recovers the criteria from the approval commit" grep -q 'git show -s --format=%b' "$S"
check "quick handles repos with no test command" grep -qi 'no `test` line' "$S"
check "high-risk asks for sign-off on the last group too" grep -qi 'every group, including the last' "$S"
check "init tells the user to commit the OpenSpec tool files" grep -q '.claude/commands/opsx/' "$I"
check "the branch step is single commands, with no pipe" absent 'symbolic-ref.*\|' "$S"
check "the PR step checks for an existing PR" grep -q 'gh pr view' "$S"
check "red log paths work in a worktree" absent '\.git/spec-deliver/' "$S"
check "the workflow finds the red log through git" absent '\.git/spec-deliver/' workflows/deliver.js
for rule in 'git switch' 'git branch' 'git symbolic-ref' 'openspec'; do
  check "settings allow $rule" grep -q "Bash($rule:\*)" "$C"
done
check "settings allow removing the state file" grep -q 'Bash(rm .config/spec-deliver/state.local.md)' "$C"
# .claude/ is a protected directory: writes there are refused unattended and prompt interactively.
check "nothing the plugin writes at run time lives in .claude" bash -c '! grep -rnE "\.claude/(spec-deliver|review-)" skills bin workflows scaffolds README.md'
# The first end-to-end run only passed because these were allowed by hand.
check "the skill needs no shell commands beyond the allow rules" bash -c '! grep -nE "command -v|test -[fd] |^ *ls -d" skills/spec-deliver/SKILL.md'
check "the skill states the single-command rule" grep -q 'one command per Bash call' "$S"
check "a denied command is not read as Bash being unavailable" grep -qi 'one denied command does not mean' "$S"
check "init ignores local state" grep -q '.config/spec-deliver/\*.local.\*' "$I"
check "creating a PR asks a human" grep -q 'Bash(gh pr create:\*)' "$C"

exit $fail
