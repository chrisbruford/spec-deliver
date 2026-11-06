#!/usr/bin/env bash
# Regression checks for defects that live in skill text, where no runtime test can reach them.
set -u
cd "$(dirname "$0")/.."
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

exit $fail
