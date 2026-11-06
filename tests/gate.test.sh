#!/usr/bin/env bash
# Behaviour tests for bin/spec-deliver-gate. Each case runs against a throwaway git repo.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
GATE="$ROOT/bin/spec-deliver-gate"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASSED=0
FAILED=0

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

ok() { PASSED=$((PASSED + 1)); echo "ok   - $1"; }
bad() { FAILED=$((FAILED + 1)); echo "FAIL - $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/       /'; }

# expect <exit-code> <text-in-result-line> <description> -- <gate args...>
expect() {
  local want=$1 text=$2 desc=$3; shift 4
  local out code last
  out=$("$GATE" "$@" 2>&1); code=$?
  last=$(printf '%s\n' "$out" | tail -1)
  if [ "$code" = "$want" ] && [[ "$last" == GATE\ * ]] && [[ "$last" == *"$text"* ]]; then
    ok "$desc"
  else
    bad "$desc" "wanted exit $want with '$text', got exit $code: $last"
  fi
}

commit() { git add -A && git commit -q --no-verify "$@"; }

# A Node repo with a passing baseline and an approval commit. Sets $APPROVED.
node_repo() {
  local dir="$WORK/$1"
  mkdir -p "$dir" && cd "$dir" || exit 1
  git init -q -b main
  mkdir -p .config/spec-deliver openspec/changes/c/specs/cap
  cat > .config/spec-deliver/verify <<'V'
# label: command
test: node --test
V
  echo 'exports.add = (a, b) => a + b' > math.js
  cat > math.test.js <<'T'
const { test } = require('node:test'); const assert = require('node:assert')
const { add } = require('./math')
test('add', () => assert.equal(add(1, 2), 3))
T
  echo 'The system SHALL multiply.' > openspec/changes/c/specs/cap/spec.md
  cat > openspec/changes/c/tasks.md <<'T'
## 1. Multiply

- [ ] 1.1 Add multiply
- [ ] 1.2 Export it

## 2. Docs (no-test)

- [ ] 2.1 Describe multiply
T
  commit -m base
  git commit -q --no-verify --allow-empty -m 'approve' -m 'Spec-Approved: c'
  APPROVED=$(git rev-parse HEAD)
}

# Commits a failing test for group 1. Red-For trailer unless told otherwise.
red_commit() {
  cat > mul.test.js <<'T'
const { test } = require('node:test'); const assert = require('node:assert')
const { mul } = require('./math')
test('mul', () => assert.equal(mul(2, 3), 6))
T
  commit -m 'test: mul' -m "Red-For: ${1:-1}"
}

implement() {
  echo 'exports.mul = (a, b) => a * b' >> math.js
  commit -m 'feat: mul'
}

# Drives group 1 through red, task and accept.
green_group() {
  red_commit
  "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
  implement
  "$GATE" task --approved "$APPROVED" --group 1 >/dev/null
  "$GATE" accept --approved "$APPROVED" --group 1 --change c >/dev/null
}

# --- input validation ---------------------------------------------------------

node_repo input
expect 2 'ERROR' 'unknown mode is rejected' -- bogus --approved "$APPROVED"
expect 2 'ERROR' 'group ids cannot carry shell or regex syntax' -- status --approved "$APPROVED" --group '1$(id)'
expect 2 'not-approved' 'a commit without Spec-Approved is refused' -- baseline --approved "$(git rev-parse HEAD~1)"
expect 2 'ERROR' 'a missing --approved is refused' -- baseline

git checkout -q -b other HEAD~1
git commit -q --no-verify --allow-empty -m 'elsewhere'
expect 2 'not-ancestor' 'an approval outside the branch history is refused' -- baseline --approved "$APPROVED"
git checkout -q main

node_repo noverify
git rm -q .config/spec-deliver/verify
git commit -q --no-verify -m 'drop verify' -m 'Spec-Approved: c'
expect 2 'no-verify-file' 'an approved commit with no verify file is refused' -- baseline --approved "$(git rev-parse HEAD)"

# --- baseline ----------------------------------------------------------------

node_repo baseline
expect 0 'PASS' 'baseline passes on a clean green tree' -- baseline --approved "$APPROVED"
echo dirt > dirt.txt
expect 1 'dirty-tree' 'baseline fails on a dirty tree' -- baseline --approved "$APPROVED"
rm dirt.txt
echo state > .config/spec-deliver/state.local.md
expect 0 'PASS' 'the state file does not count as dirt' -- baseline --approved "$APPROVED"
rm .config/spec-deliver/state.local.md
echo 'exports.add = () => 0' > math.js
commit -m broke
expect 1 'verify-failed' 'baseline fails when verify commands fail' -- baseline --approved "$APPROVED"

# --- red ---------------------------------------------------------------------

node_repo red-ok
red_commit
expect 0 'PASS' 'red passes when the new test fails' -- red --approved "$APPROVED" --group 1
[ -s "$(git rev-parse --absolute-git-dir)/spec-deliver/1.red.log" ] && ok 'red keeps its failure log' || bad 'red keeps its failure log'

node_repo red-already-green
echo 'exports.mul = (a, b) => a * b' >> math.js
commit -m 'feat: mul'
red_commit
expect 1 'passes-at-red' 'a test passing at red stops the run' -- red --approved "$APPROVED" --group 1

node_repo red-no-trailer
expect 1 'no-red-commit' 'red fails without a Red-For commit' -- red --approved "$APPROVED" --group 1

node_repo red-no-tests
echo notes > notes.txt
commit -m 'not a test' -m 'Red-For: 1'
expect 1 'no-test-files' 'a red commit touching no test file fails' -- red --approved "$APPROVED" --group 1

node_repo red-moved-on
red_commit
implement
expect 1 'head-not-red' 'red must run at the red commit' -- red --approved "$APPROVED" --group 1

node_repo red-prefix
red_commit 10
expect 1 'no-red-commit' 'group 1 does not match the trailer of group 10' -- red --approved "$APPROVED" --group 1

# --- task --------------------------------------------------------------------

node_repo task-ok
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null; implement
expect 0 'PASS' 'task passes after a real red to green' -- task --approved "$APPROVED" --group 1

node_repo task-unchecked
red_commit; implement
expect 1 'red-not-checked' 'task needs a checked red commit' -- task --approved "$APPROVED" --group 1

node_repo task-failing
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
echo 'exports.mul = () => 0' >> math.js; commit -m 'wrong'
expect 1 'verify-failed' 'task fails when tests still fail' -- task --approved "$APPROVED" --group 1

node_repo task-test-edit
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
sed -i.bak 's/6/0/' mul.test.js && rm mul.test.js.bak
echo 'exports.mul = () => 0' >> math.js; commit -m 'cheat'
expect 1 'test-edited' 'tampering: weakening the test fails even though tests pass' -- task --approved "$APPROVED" --group 1

node_repo task-test-delete
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
git rm -q mul.test.js; commit -m 'cheat'
expect 1 'test-edited' 'tampering: deleting the test fails' -- task --approved "$APPROVED" --group 1

node_repo task-verify-edit
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
echo 'test: true' > .config/spec-deliver/verify; commit -m 'cheat'
expect 1 'protected-path' 'tampering: editing the verify file fails' -- task --approved "$APPROVED" --group 1

node_repo task-weak-verify
cat > .config/spec-deliver/verify <<'V'
test: node --test
protect: ^locked/
V
commit -m config
git commit -q --no-verify --allow-empty -m 'approve' -m 'Spec-Approved: c'
APPROVED=$(git rev-parse HEAD)
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
echo 'test: true' > .config/spec-deliver/verify; commit -m cheat
expect 1 'verify-failed' 'tampering: commands come from the approved commit, not HEAD' -- task --approved "$APPROVED" --group 1

node_repo task-test-rename
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
git mv mul.test.js mul-notes.txt; commit -m cheat
expect 1 'test-edited' 'tampering: renaming a test out of the test pattern fails' -- task --approved "$APPROVED" --group 1

node_repo task-spec-rename
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
git mv openspec/changes/c/specs/cap/spec.md old-spec.md; implement
expect 1 'protected-path' 'tampering: moving the approved spec away fails' -- task --approved "$APPROVED" --group 1

node_repo task-spec-edit
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
echo 'weaker' >> openspec/changes/c/specs/cap/spec.md; implement
expect 1 'protected-path' 'tampering: editing the approved spec fails' -- task --approved "$APPROVED" --group 1

node_repo task-ci-edit
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
mkdir -p .github/workflows; echo x > .github/workflows/ci.yml; implement
expect 1 'protected-path' 'tampering: editing CI fails' -- task --approved "$APPROVED" --group 1

node_repo task-runner-config
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
echo 'module.exports = {}' > jest.config.js; implement
expect 1 'protected-path' 'tampering: editing test runner config fails' -- task --approved "$APPROVED" --group 1

node_repo task-dirty
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null; implement
echo extra >> math.js
expect 1 'dirty-tree' 'task fails on uncommitted work' -- task --approved "$APPROVED" --group 1

# --- no-test and refactor groups ---------------------------------------------

node_repo notest
echo docs > README.md; commit -m docs
expect 0 'PASS' 'a no-test group skips red but runs verify commands' -- task --approved "$APPROVED" --group 2 --no-test

node_repo notest-fail
echo 'exports.add = () => 0' > math.js; commit -m broke
expect 1 'verify-failed' 'a no-test group still fails on broken verify commands' -- task --approved "$APPROVED" --group 2 --no-test

node_repo refactor
START=$(git rev-parse HEAD)
echo '// tidy' >> math.js; commit -m refactor
expect 0 'PASS' 'a refactor group passes with tests untouched' -- task --approved "$APPROVED" --group 2 --no-test --since "$START"

node_repo refactor-test-edit
START=$(git rev-parse HEAD)
echo '// edit' >> math.test.js; commit -m refactor
expect 1 'test-edited' 'a refactor group fails if tests change' -- task --approved "$APPROVED" --group 2 --no-test --since "$START"

# --- accept ------------------------------------------------------------------

node_repo accept
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null; implement
"$GATE" task --approved "$APPROVED" --group 1 >/dev/null
expect 0 'PASS' 'accept passes after task' -- accept --approved "$APPROVED" --group 1 --change c
[ "$(grep -c '^- \[x\]' openspec/changes/c/tasks.md)" = 2 ] && ok 'accept ticks every task in the group' || bad 'accept ticks every task in the group'
grep -q '^- \[ \] 2.1' openspec/changes/c/tasks.md && ok 'accept leaves other groups alone' || bad 'accept leaves other groups alone'
git log -1 --format=%B | grep -q '^Green-For: 1$' && ok 'accept commits a Green-For trailer' || bad 'accept commits a Green-For trailer'

node_repo accept-stale
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null; implement
"$GATE" task --approved "$APPROVED" --group 1 >/dev/null
echo '// later' >> math.js; commit -m later
expect 1 'task-not-passed' 'accept refuses if HEAD moved since task passed' -- accept --approved "$APPROVED" --group 1 --change c

node_repo accept-no-task
red_commit
expect 1 'task-not-passed' 'accept refuses without a task pass' -- accept --approved "$APPROVED" --group 1 --change c

node_repo accept-no-section
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null; implement
"$GATE" task --approved "$APPROVED" --group 1 >/dev/null
sed -i.bak 's/^## 1\. /## 9. /' openspec/changes/c/tasks.md && rm openspec/changes/c/tasks.md.bak; commit -m rename
"$GATE" task --approved "$APPROVED" --group 1 >/dev/null
expect 2 'no-group-section' 'accept fails when tasks.md has no such group' -- accept --approved "$APPROVED" --group 1 --change c

node_repo accept-quick
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null; implement
"$GATE" task --approved "$APPROVED" --group 1 >/dev/null
expect 0 'PASS' 'accept works without a change for quick deliveries' -- accept --approved "$APPROVED" --group 1

# --- status ------------------------------------------------------------------

node_repo status
expect 0 'state=none' 'status reports none' -- status --approved "$APPROVED" --group 1
red_commit
expect 0 'state=red-unchecked' 'status reports an unchecked red commit' -- status --approved "$APPROVED" --group 1
"$GATE" red --approved "$APPROVED" --group 1 >/dev/null
expect 0 'state=red' 'status reports a checked red commit' -- status --approved "$APPROVED" --group 1
implement
"$GATE" task --approved "$APPROVED" --group 1 >/dev/null
"$GATE" accept --approved "$APPROVED" --group 1 --change c >/dev/null
expect 0 'state=green' 'status reports green' -- status --approved "$APPROVED" --group 1

# --- final -------------------------------------------------------------------

accept_docs() {
  echo docs > README.md; commit -m docs
  "$GATE" task --approved "$APPROVED" --group 2 --no-test >/dev/null
  "$GATE" accept --approved "$APPROVED" --group 2 --change c --no-test 'docs only' >/dev/null
}

node_repo final-ok
green_group; accept_docs
expect 0 'PASS' 'final passes on a complete delivery' -- final --approved "$APPROVED" --change c

node_repo final-unticked
green_group
expect 1 'tasks-unticked' 'final fails with unticked tasks' -- final --approved "$APPROVED" --change c

node_repo final-open-red
green_group; accept_docs
git commit -q --no-verify --allow-empty -m 'test: more' -m 'Red-For: 3'
expect 1 'red-without-green' 'final fails on a red commit that never went green' -- final --approved "$APPROVED" --change c

node_repo final-window
red_commit; "$GATE" red --approved "$APPROVED" --group 1 >/dev/null
sed -i.bak 's/6/0/' mul.test.js && rm mul.test.js.bak
echo 'exports.mul = () => 0' >> math.js; commit -m cheat
git commit -q --no-verify --allow-empty -m 'forged' -m 'Green-For: 1'
sed -i.bak 's/- \[ \]/- [x]/' openspec/changes/c/tasks.md && rm openspec/changes/c/tasks.md.bak; commit -m ticks
expect 1 'test-edited' 'tampering: final catches a test edit behind a forged Green-For' -- final --approved "$APPROVED" --change c

node_repo final-qa-test
green_group; accept_docs
echo '// qa' >> mul.test.js; commit -m 'qa: strengthen test'
expect 0 'PASS' 'a test changed after green, in QA, is allowed' -- final --approved "$APPROVED" --change c

node_repo final-no-reason
green_group
echo docs > README.md; commit -m docs
sed -i.bak 's/- \[ \]/- [x]/' openspec/changes/c/tasks.md && rm openspec/changes/c/tasks.md.bak; commit -m ticks
git commit -q --no-verify --allow-empty -m 'forged' -m 'Green-For: 2'
expect 1 'green-without-red' 'tampering: a green group with no red and no reason fails' -- final --approved "$APPROVED" --change c

node_repo final-forged-red
red_commit
implement
git commit -q --no-verify --allow-empty -m 'forged' -m 'Green-For: 1'
sed -i.bak 's/- \[ \]/- [x]/' openspec/changes/c/tasks.md && rm openspec/changes/c/tasks.md.bak; commit -m ticks
expect 1 'red-not-checked' 'tampering: final needs proof that red was checked' -- final --approved "$APPROVED" --change c

node_repo final-empty
expect 1 'nothing-delivered' 'final fails when nothing was delivered' -- final --approved "$APPROVED"

node_repo final-broken
green_group; accept_docs
echo 'exports.add = () => 0' > math.js; commit -m broke
expect 1 'verify-failed' 'final fails when verify commands fail' -- final --approved "$APPROVED" --change c

# --- repo-specific configuration ---------------------------------------------

node_repo custom-protect
cat > .config/spec-deliver/verify <<'V'
test: node --test
protect: ^locked/
test-files: \.check\.js$
V
commit -m config
git commit -q --no-verify --allow-empty -m 'approve' -m 'Spec-Approved: c'
APPROVED=$(git rev-parse HEAD)
mkdir -p .github/workflows; echo x > .github/workflows/ci.yml; commit -m 'allowed ci'
expect 0 'PASS' 'protect replaces the defaults at approval' -- baseline --approved "$APPROVED"
mkdir -p locked; echo x > locked/a; commit -m locked
expect 1 'protected-path' 'a custom protect pattern is enforced' -- task --approved "$APPROVED" --group 2 --no-test
git reset -q --hard HEAD~1
echo notes > a.check.js; commit -m 'custom test name' -m 'Red-For: 1'
expect 1 'passes-at-red' 'test-files pattern decides what counts as a test' -- red --approved "$APPROVED" --group 1

node_repo no-test-label
echo 'lint: true' > .config/spec-deliver/verify; commit -m config
git commit -q --no-verify --allow-empty -m 'approve' -m 'Spec-Approved: c'
APPROVED=$(git rev-parse HEAD)
red_commit
expect 2 'no-test-command' 'red needs a test command' -- red --approved "$APPROVED" --group 1

# --- other stacks ------------------------------------------------------------

python_cycle() {
  local dir="$WORK/python"
  mkdir -p "$dir/.config/spec-deliver" "$dir/tests" && cd "$dir" || exit 1
  git init -q -b main
  echo 'test: python3 -m unittest discover -s tests' > .config/spec-deliver/verify
  echo 'def add(a, b): return a + b' > calc.py
  cat > tests/test_add.py <<'T'
import sys, unittest
sys.path.insert(0, '.')
from calc import add
class T(unittest.TestCase):
    def test_add(self): self.assertEqual(add(1, 2), 3)
T
  printf '__pycache__/\n' > .gitignore
  commit -m base
  git commit -q --no-verify --allow-empty -m approve -m 'Spec-Approved: py'
  APPROVED=$(git rev-parse HEAD)
  cat > tests/test_mul.py <<'T'
import sys, unittest
sys.path.insert(0, '.')
import calc
class T(unittest.TestCase):
    def test_mul(self): self.assertEqual(calc.mul(2, 3), 6)
T
  commit -m 'test: mul' -m 'Red-For: 1'
  expect 0 'PASS' 'python: red' -- red --approved "$APPROVED" --group 1
  echo 'def mul(a, b): return a * b' >> calc.py
  commit -m 'feat: mul'
  expect 0 'PASS' 'python: task' -- task --approved "$APPROVED" --group 1
  expect 0 'PASS' 'python: accept' -- accept --approved "$APPROVED" --group 1
  expect 0 'PASS' 'python: final' -- final --approved "$APPROVED"
}
python_cycle

# .NET layout, with a stand-in runner so this stays fast. dotnet_cycle below runs the real thing.
dotnet_layout() {
  local dir="$WORK/dotnet-layout"
  mkdir -p "$dir/.config/spec-deliver" "$dir/Calc.Tests" && cd "$dir" || exit 1
  git init -q -b main
  echo 'test: test ! -f failing' > .config/spec-deliver/verify
  commit -m base
  git commit -q --no-verify --allow-empty -m approve -m 'Spec-Approved: net'
  APPROVED=$(git rev-parse HEAD)
  echo stub > Calc.Tests/CalcTests.cs; echo x > failing
  commit -m 'test: mul' -m 'Red-For: 1'
  expect 0 'PASS' '.NET: Calc.Tests/CalcTests.cs counts as a test file' -- red --approved "$APPROVED" --group 1
  git rm -q failing; echo edit >> Calc.Tests/CalcTests.cs; commit -m cheat
  expect 1 'test-edited' '.NET: editing CalcTests.cs is caught' -- task --approved "$APPROVED" --group 1
}
dotnet_layout

dotnet_cycle() {
  local dir="$WORK/dotnet"
  mkdir -p "$dir/.config/spec-deliver" && cd "$dir" || exit 1
  git init -q -b main
  dotnet new sln -n Calc >/dev/null
  dotnet new classlib -n Calc >/dev/null
  dotnet new xunit -n Calc.Tests >/dev/null
  dotnet add Calc.Tests reference Calc >/dev/null
  dotnet sln add Calc Calc.Tests >/dev/null
  rm -f Calc/Class1.cs Calc.Tests/UnitTest1.cs
  printf 'namespace Calc;\npublic static class Maths { public static int Mul(int a, int b) => 0; }\n' > Calc/Maths.cs
  printf 'bin/\nobj/\n' > .gitignore
  echo 'test: dotnet test --nologo' > .config/spec-deliver/verify
  commit -m base
  git commit -q --no-verify --allow-empty -m approve -m 'Spec-Approved: net'
  APPROVED=$(git rev-parse HEAD)
  # The stub compiles, so red fails on an assertion rather than on a missing symbol.
  cat > Calc.Tests/MathsTests.cs <<'T'
using Xunit;
public class MathsTests { [Fact] public void Mul() => Assert.Equal(6, Calc.Maths.Mul(2, 3)); }
T
  commit -m 'test: mul' -m 'Red-For: 1'
  expect 0 'PASS' '.NET: red against a compiling stub' -- red --approved "$APPROVED" --group 1
  printf 'namespace Calc;\npublic static class Maths { public static int Mul(int a, int b) => a * b; }\n' > Calc/Maths.cs
  commit -m 'feat: mul'
  expect 0 'PASS' '.NET: task' -- task --approved "$APPROVED" --group 1
}
if command -v dotnet >/dev/null 2>&1; then dotnet_cycle; else echo "skip - dotnet not installed, real .NET cycle not run"; fi

echo
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" = 0 ]
