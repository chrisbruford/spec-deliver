import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from './harness.mjs'

const run = load('workflows/deliver.js')
const SHA = 'abc1234'
const base = {
  change: 'add-mul',
  approvedSha: SHA,
  groups: [{ id: '1', title: 'Multiply', kind: 'code' }],
}

const pass = (mode, extra = '') => ({ exit: 0, resultLine: `GATE ${mode} PASS group=1 head=def5678 ${extra}`.trim(), tail: '' })
const failed = (mode, reason) => ({ exit: 1, resultLine: `GATE ${mode} FAIL group=1 head=def5678 reason=${reason}`, tail: 'output' })
const clean = { scenarios: [{ scenario: 'mul multiplies', verdict: 'met', evidence: 'mul.test.js:3' }], blocking: [], escalate: [], notes: [] }
const modeOf = call => /spec-deliver-gate (\w+)/.exec(call.prompt)?.[1]

// A fake delivery where everything succeeds, with per-call overrides.
const world = (overrides = {}) => call => {
  const label = call.label
  if (label.startsWith('gate')) {
    const mode = modeOf(call)
    if (overrides[mode]) return overrides[mode](call)
    return mode === 'status' ? pass('status', 'state=none base=aaa1111') : pass(mode)
  }
  if (label.startsWith('test-writer')) return overrides.writer ? overrides.writer(call) : { head: 'def5678', blocked: '' }
  if (label.startsWith('implement')) return overrides.implementer ? overrides.implementer(call) : { head: 'def5678', blocked: '' }
  if (label.startsWith('review')) return overrides.reviewer ? overrides.reviewer(call) : { blocking: [], notes: [] }
  if (label === 'conformance') return overrides.conformance ? overrides.conformance(call) : clean
  throw new Error(`unexpected agent ${label}`)
}

const labels = calls => calls.map(c => (c.label.startsWith('gate') ? `gate:${modeOf(c)}` : c.label.split(' ')[0]))

test('refuses to start without an approved commit', async () => {
  const { result, calls } = await run({ ...base, approvedSha: undefined }, world())
  assert.equal(result.status, 'refused')
  assert.equal(calls.length, 0)
})

test('refuses to start when typed directly with no args', async () => {
  const { result, calls } = await run(undefined, world())
  assert.equal(result.status, 'refused')
  assert.equal(calls.length, 0)
})

test('refuses values that would reach a shell command', async () => {
  for (const args of [
    { ...base, approvedSha: 'abc; rm -rf /' },
    { ...base, change: 'x$(id)' },
    { ...base, groups: [{ id: '1 --no-test', title: 't', kind: 'code' }] },
    { ...base, groups: [{ id: '1', title: 't', kind: 'bogus' }] },
    { ...base, groups: [] },
  ]) {
    const { result, calls } = await run(args, world())
    assert.equal(result.status, 'refused', JSON.stringify(args))
    assert.equal(calls.length, 0)
  }
})

test('delivers a code group in order', async () => {
  const { result, calls } = await run(base, world())
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.delivered, ['1'])
  assert.deepEqual(labels(calls), ['gate:status', 'gate:baseline', 'test-writer', 'gate:red', 'implement', 'review', 'gate:task', 'conformance'])
})

test('gate commands carry approval, group and change', async () => {
  const { calls } = await run(base, world())
  const task = calls.find(c => modeOf(c) === 'task')
  assert.match(task.prompt, /spec-deliver-gate task --approved abc1234 --group 1 --change add-mul --head def5678/)
  assert.equal(task.agentType, 'spec-deliver:gate-runner')
})

test('skips groups already green', async () => {
  const { result, calls } = await run(base, world({ status: () => pass('status', 'state=green base=aaa1111') }))
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.skipped, ['1'])
  assert.deepEqual(labels(calls), ['gate:status', 'conformance'])
})

test('a null agent result fails closed', async () => {
  for (const point of ['status', 'baseline', 'red', 'task', 'writer', 'implementer', 'reviewer', 'conformance']) {
    const { result } = await run(base, world({ [point]: () => null }))
    assert.equal(result.status, 'stopped', point)
    assert.match(result.reason, /agent-failed/, point)
  }
})

test('exit 0 with a failing result line is not a pass', async () => {
  const { result } = await run(base, world({ baseline: () => ({ exit: 0, resultLine: 'GATE baseline FAIL reason=x', tail: '' }) }))
  assert.equal(result.status, 'stopped')
})

test('a pass line with a non-zero exit is not a pass', async () => {
  const { result } = await run(base, world({ baseline: () => ({ exit: 1, resultLine: 'GATE baseline PASS', tail: '' }) }))
  assert.equal(result.status, 'stopped')
})

test('a pass line from the wrong mode is not a pass', async () => {
  const { result } = await run(base, world({ baseline: () => pass('final') }))
  assert.equal(result.status, 'stopped')
})

test('a failing baseline stops before any work', async () => {
  const { result, calls } = await run(base, world({ baseline: () => failed('baseline', 'verify-failed') }))
  assert.equal(result.status, 'stopped')
  assert.equal(calls.some(c => c.label.startsWith('test-writer')), false)
})

test('a test passing at red stops without retrying or implementing', async () => {
  const { result, calls } = await run(base, world({ red: () => failed('red', 'passes-at-red') }))
  assert.equal(result.status, 'stopped')
  assert.match(result.reason, /passes-at-red/)
  assert.equal(calls.filter(c => c.label.startsWith('test-writer')).length, 1)
  assert.equal(calls.some(c => c.label.startsWith('implement')), false)
})

test('a bad red commit is retried, then stops', async () => {
  const { result, calls } = await run(base, world({ red: () => failed('red', 'no-test-files') }))
  assert.equal(result.status, 'stopped')
  assert.equal(calls.filter(c => c.label.startsWith('test-writer')).length, 3)
})

test('the implementer gets 2 retries, then the run stops', async () => {
  const { result, calls } = await run(base, world({ task: () => failed('task', 'verify-failed') }))
  assert.equal(result.status, 'stopped')
  assert.equal(result.group, '1')
  assert.equal(calls.filter(c => c.label.startsWith('implement')).length, 3)
})

test('the group reviewer is told allow rules match single commands', async () => {
  const { calls } = await run(base, world())
  assert.match(calls.find(c => c.label.startsWith('review')).prompt, /one command per Bash call/i)
})

test('a retry tells the implementer why it failed', async () => {
  let tries = 0
  const { result, calls } = await run(base, world({ task: () => (++tries === 1 ? failed('task', 'verify-failed') : pass('task')) }))
  assert.equal(result.status, 'complete')
  const second = calls.filter(c => c.label.startsWith('implement'))[1]
  assert.match(second.prompt, /verify-failed/)
})

test('retries are forward-only', async () => {
  const { calls } = await run(base, world())
  const implementer = calls.find(c => c.label.startsWith('implement'))
  assert.match(implementer.prompt, /never rewrite history/i)
})

test('blocking review findings go back to the implementer', async () => {
  let tries = 0
  const reviewer = () => (++tries === 1 ? { blocking: ['the test is vacuous'], notes: [] } : { blocking: [], notes: [] })
  const { result, calls } = await run(base, world({ reviewer }))
  assert.equal(result.status, 'complete')
  const second = calls.filter(c => c.label.startsWith('implement'))[1]
  assert.match(second.prompt, /the test is vacuous/)
})

test('review that never clears stops before the task gate', async () => {
  const { result, calls } = await run(base, world({ reviewer: () => ({ blocking: ['still wrong'], notes: [] }) }))
  assert.equal(result.status, 'stopped')
  assert.equal(calls.some(c => modeOf(c) === 'task'), false)
})

test('an implementer reporting a wrong test stops for a human', async () => {
  const { result, calls } = await run(base, world({ implementer: () => ({ head: 'def5678', blocked: 'test contradicts the spec' }) }))
  assert.equal(result.status, 'stopped')
  assert.equal(result.reason, 'blocked')
  assert.match(result.detail, /contradicts the spec/)
  assert.equal(calls.filter(c => c.label.startsWith('implement')).length, 1)
})

test('a test defect stops with its own reason, so the skill can offer a test fix', async () => {
  const { result } = await run(base, world({ implementer: () => ({ head: 'def5678', blocked: 'test-defect: a.test.js:9 wrong collation' }) }))
  assert.equal(result.status, 'stopped')
  assert.equal(result.reason, 'test-defect')
  assert.match(result.detail, /collation/)
})

test('the task gate checks the head the implementer reported', async () => {
  const { calls } = await run(base, world({ implementer: () => ({ head: '9999999', blocked: '' }) }))
  assert.match(calls.find(c => modeOf(c) === 'task').prompt, /--head 9999999/)
})

test('a head that moved after review goes back to the implementer', async () => {
  let tries = 0
  const { result, calls } = await run(base, world({ task: () => (++tries === 1 ? failed('task', 'head-moved') : pass('task')) }))
  assert.equal(result.status, 'complete')
  assert.match(calls.filter(c => c.label.startsWith('implement'))[1].prompt, /not def5678/)
})

test('a head that is not a sha never reaches a command', async () => {
  const { result, calls } = await run(base, world({ implementer: () => ({ head: '$(id)', blocked: '' }) }))
  assert.equal(result.status, 'stopped')
  assert.equal(calls.some(c => c.prompt.includes('$(id)')), false)
})

test('agents are told the gate alone writes trailers and ticks', async () => {
  const { calls } = await run(base, world())
  assert.match(calls.find(c => c.label.startsWith('implement')).prompt, /never write Red-For, Green-For/i)
  assert.match(calls.find(c => c.label.startsWith('test-writer')).prompt, /--trailer "Red-For: 1"/)
})

test('the agent cap stops the run', async () => {
  const { result, calls } = await run({ ...base, maxAgents: 3 }, world())
  assert.equal(result.status, 'stopped')
  assert.match(result.reason, /agent-cap/)
  assert.equal(calls.length, 3)
})

test('the token cap stops the run', async () => {
  const { result, calls } = await run({ ...base, maxOutputTokens: 100 }, world(), { spent: () => 100 })
  assert.equal(result.status, 'stopped')
  assert.match(result.reason, /token-cap/)
  assert.equal(calls.length, 0)
})

test('resuming at a checked red skips the test writer and baseline', async () => {
  const { result, calls } = await run(base, world({ status: () => pass('status', 'state=red base=aaa1111') }))
  assert.equal(result.status, 'complete')
  assert.deepEqual(labels(calls), ['gate:status', 'implement', 'review', 'gate:task', 'conformance'])
})

test('resuming at an unchecked red reruns the red check', async () => {
  const { calls } = await run(base, world({ status: () => pass('status', 'state=red-unchecked base=aaa1111') }))
  assert.deepEqual(labels(calls), ['gate:status', 'gate:red', 'implement', 'review', 'gate:task', 'conformance'])
})

test('no-test groups skip red and pass the gate with a reason', async () => {
  const { result, calls } = await run({ ...base, groups: [{ id: '2', title: 'Docs', kind: 'no-test' }] }, world())
  assert.equal(result.status, 'complete')
  assert.equal(calls.some(c => c.label.startsWith('test-writer')), false)
  assert.match(calls.find(c => modeOf(c) === 'task').prompt, /--change add-mul --no-test no-test-group/)
})

test('only code groups inherit the session model', async () => {
  const { calls } = await run({ ...base, groups: [{ id: '1', title: 'A', kind: 'code' }, { id: '2', title: 'Docs', kind: 'no-test' }] }, world())
  const implementers = calls.filter(c => c.label.startsWith('implement'))
  assert.equal(implementers[0].model, undefined)
  assert.equal(implementers[1].model, 'sonnet')
})

test('a QA group carries its finding and ticks nothing', async () => {
  const groups = [{ id: 'qa1', title: 'Sign out ends the SSO session', kind: 'code', qa: true, detail: 'Finding: sign out does nothing' }]
  const { result, calls } = await run({ ...base, groups }, world())
  assert.equal(result.status, 'complete')
  assert.match(calls.find(c => c.label.startsWith('test-writer')).prompt, /sign out does nothing/)
  assert.doesNotMatch(calls.find(c => modeOf(c) === 'task').prompt, /--change/)
})

test('a QA group must be test-first', async () => {
  const { result, calls } = await run({ ...base, groups: [{ id: 'qa1', title: 't', kind: 'no-test', qa: true }] }, world())
  assert.equal(result.status, 'refused')
  assert.equal(calls.length, 0)
})

test('refactor groups pin the starting commit', async () => {
  const { calls } = await run({ ...base, groups: [{ id: '3', title: 'Tidy', kind: 'refactor' }] }, world())
  assert.match(calls.find(c => modeOf(c) === 'task').prompt, /--no-test refactor-group --since aaa1111/)
})

// Field run add-mutation-tests: no-test groups that add tests stopped as test-defect.
test('implementer test rules follow the group kind', async () => {
  const groups = [{ id: '1', title: 'A', kind: 'code' }, { id: '2', title: 'B', kind: 'refactor' }, { id: '3', title: 'C', kind: 'no-test' }]
  const { calls } = await run({ ...base, groups }, world())
  const [code, refactor, noTest] = calls.filter(c => c.label.startsWith('implement')).map(c => c.prompt)
  assert.match(code, /never edit test files/i)
  assert.match(refactor, /never edit test files/i)
  assert.doesNotMatch(noTest, /never edit test files/i)
  assert.match(noTest, /may add and edit tests/i)
})

test('a change a task names is in scope, and the prompt claims only what the gate checks', async () => {
  const { calls } = await run({ ...base, groups: [{ id: '2', title: 'Docs', kind: 'no-test' }] }, world())
  const prompt = calls.find(c => c.label.startsWith('implement')).prompt
  assert.match(prompt, /unless a task in this group says to/i)
  assert.doesNotMatch(prompt, /test runner config\. The gate fails/i)
})

test('the implementer runs the group Gate: command before the gate does', async () => {
  const { calls } = await run(base, world())
  assert.match(calls.find(c => c.label.startsWith('implement')).prompt, /Gate: line/)
})

test('quick deliveries work from a brief, without a change', async () => {
  const { result, calls } = await run({ approvedSha: SHA, brief: 'mul multiplies', groups: [{ id: '1', title: 'Fix', kind: 'code' }] }, world())
  assert.equal(result.status, 'complete')
  assert.match(calls.find(c => c.label.startsWith('test-writer')).prompt, /mul multiplies/)
  assert.doesNotMatch(calls.find(c => modeOf(c) === 'task').prompt, /--change/)
})

test('a resumed group is reviewed from its real base', async () => {
  const { calls } = await run(base, world({ status: () => pass('status', 'state=red base=aaa1111') }))
  assert.match(calls.find(c => c.label.startsWith('review')).prompt, /diff aaa1111\.\.HEAD/)
})

test('a base that is not a sha stops before reaching a command', async () => {
  const { result, calls } = await run({ ...base, groups: [{ id: '3', title: 'Tidy', kind: 'refactor' }] }, world({
    status: () => pass('status', 'state=none base=$(id)'),
  }))
  assert.equal(result.status, 'stopped')
  assert.equal(calls.some(c => c.prompt.includes('$(id)')), false)
})

test('a null change counts as no change', async () => {
  const { result, calls } = await run({ ...base, change: null }, world())
  assert.equal(result.status, 'refused')
  assert.equal(calls.length, 0)
})

test('groups run in order and a stop leaves later groups untouched', async () => {
  const groups = [{ id: '1', title: 'A', kind: 'code' }, { id: '2', title: 'B', kind: 'code' }]
  const { result, calls } = await run({ ...base, groups }, world({ task: () => failed('task', 'verify-failed') }))
  assert.equal(result.status, 'stopped')
  assert.deepEqual(result.delivered, [])
  assert.equal(calls.some(c => /--group 2/.test(c.prompt)), false)
})

test('the group reviewer checks the work so far against the whole change', async () => {
  const { calls } = await run(base, world())
  const prompt = calls.find(c => c.label.startsWith('review')).prompt
  assert.match(prompt, /git diff abc1234\.\.HEAD/)
  assert.match(prompt, /design\.md/)
  assert.match(prompt, /earlier group/i)
})

test('conformance reviews the whole delivery against the whole change', async () => {
  const { calls } = await run(base, world())
  const review = calls.find(c => c.label === 'conformance')
  assert.equal(review.agentType, 'spec-deliver:qa-code-reviewer')
  assert.match(review.prompt, /openspec\/changes\/add-mul\/: proposal\.md, design\.md, tasks\.md and specs\//)
  assert.match(review.prompt, /git diff abc1234\.\.HEAD/)
  assert.match(review.prompt, /every scenario/i)
})

test('quick deliveries are checked against the brief', async () => {
  const { calls } = await run({ approvedSha: SHA, brief: 'mul multiplies', groups: [{ id: '1', title: 'Fix', kind: 'code' }] }, world())
  assert.match(calls.find(c => c.label === 'conformance').prompt, /mul multiplies/)
})

test('a complete result carries the scenario verdicts', async () => {
  const { result } = await run(base, world())
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.conformance, clean.scenarios)
})

test('conformance findings are fixed test-first in a fix group, then reviewed again', async () => {
  let rounds = 0
  const conformance = () => (++rounds === 1 ? { ...clean, blocking: ['zero times anything is not zero'] } : clean)
  const { result, calls } = await run(base, world({ conformance }))
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.delivered, ['1', 'conf-def5678'])
  assert.deepEqual(labels(calls).slice(7), ['conformance', 'gate:status', 'test-writer', 'gate:red', 'implement', 'review', 'gate:task', 'conformance'])
  assert.match(calls.find(c => c.label === 'test-writer conf-def5678').prompt, /zero times anything is not zero/)
  // A fix group is not in the approved tasks.md, so it ticks nothing.
  assert.doesNotMatch(calls.filter(c => modeOf(c) === 'task').at(-1).prompt, /--change/)
})

test('conformance that never clears stops after the fix rounds', async () => {
  const { result, calls } = await run(base, world({ conformance: () => ({ ...clean, blocking: ['still wrong'] }) }))
  assert.equal(result.status, 'stopped')
  assert.equal(result.reason, 'conformance-failed')
  assert.match(result.detail, /still wrong/)
  assert.equal(calls.filter(c => c.label === 'conformance').length, 3)
})

test('findings no test can prove stop for a human, with no fix round', async () => {
  const conformance = () => ({ ...clean, blocking: ['also this'], escalate: ['the cache layer design.md asks for is missing'] })
  const { result, calls } = await run(base, world({ conformance }))
  assert.equal(result.status, 'stopped')
  assert.equal(result.reason, 'conformance-escalate')
  assert.match(result.detail, /cache layer/)
  assert.equal(calls.filter(c => c.label.startsWith('test-writer')).length, 1)
})

test('a stop inside a fix group returns the group, so a rerun can resume it', async () => {
  let reds = 0
  const { result } = await run(base, world({
    conformance: () => ({ ...clean, blocking: ['zero case'] }),
    red: () => (++reds === 1 ? pass('red') : failed('red', 'passes-at-red')),
  }))
  assert.equal(result.status, 'stopped')
  assert.equal(result.group, 'conf-def5678')
  assert.deepEqual(result.fixGroup, { id: 'conf-def5678', title: 'Conformance fixes', kind: 'code', qa: true, detail: 'Conformance findings:\n- zero case' })
})

test('a head that is not a sha never becomes a fix group id', async () => {
  const { result, calls } = await run(base, world({
    conformance: () => ({ ...clean, blocking: ['zero case'] }),
    task: () => ({ exit: 0, resultLine: 'GATE task PASS group=1 head=$(id)', tail: '' }),
  }))
  assert.equal(result.status, 'stopped')
  assert.equal(calls.some(c => c.prompt.includes('$(id)')), false)
})

// With --signoff each run delivers one group, so later groups' scenarios are not missing yet.
test('a run that is not the last can skip conformance', async () => {
  const { result, calls } = await run({ ...base, conformance: false }, world())
  assert.equal(result.status, 'complete')
  assert.equal(calls.some(c => c.label === 'conformance'), false)
})
