import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from './harness.mjs'

const run = load('workflows/review.js')
const base = { base: 'main', branch: 'feat', files: ['a.ts', 'b.ts'] }

const finding = (over = {}) => ({
  severity: 'High', title: 'bug', file: 'a.ts', line: 10, evidence: 'e', scenario: 's', impact: 'i', suggestion: 'x', ...over,
})
const report = (findings = [], over = {}) => ({ findings, filesReviewed: ['a.ts', 'b.ts'], positives: [], ...over })

// Every lens reports nothing and every verdict is real, unless overridden.
const world = (o = {}) => call => {
  const label = call.label
  if (label === 'select lenses') return o.select ? o.select(call) : { lenses: ['concurrency', 'observability', 'contract', 'ops'], skipped: [] }
  if (label.startsWith('lens ')) {
    const lens = label.slice(5)
    return o.lens?.[lens] !== undefined ? o.lens[lens](call) : report()
  }
  if (label.startsWith('verify ')) return o.verify ? o.verify(call) : { verdicts: JSON.parse(/INDEXES:(\[.*\])/.exec(call.prompt)[1]).map(index => ({ index, real: true, reason: 'confirmed', duplicateOf: null })) }
  throw new Error(`unexpected agent ${label}`)
}
const lensesRun = calls => calls.filter(c => c.label.startsWith('lens ')).map(c => c.label.slice(5)).sort()

test('refuses without a base or files', async () => {
  for (const args of [undefined, { ...base, base: '' }, { ...base, files: [] }]) {
    const { result, calls } = await run(args, world())
    assert.equal(result.status, 'refused')
    assert.equal(calls.length, 0)
  }
})

test('refuses a base that would reach a shell command', async () => {
  const { result, calls } = await run({ ...base, base: 'main; rm -rf /' }, world())
  assert.equal(result.status, 'refused')
  assert.equal(calls.length, 0)
})

test('core lenses always run, whatever the selector says', async () => {
  const { calls } = await run(base, world({ select: () => ({ lenses: [], skipped: [{ lens: 'ops', reason: 'no deploy changes' }] }) }))
  assert.deepEqual(lensesRun(calls), ['adversarial', 'qa', 'security', 'tests'])
})

test('selected lenses join the core, and skips are reported', async () => {
  const { result, calls } = await run(base, world({ select: () => ({ lenses: ['ops'], skipped: [{ lens: 'contract', reason: 'no api change' }] }) }))
  assert.deepEqual(lensesRun(calls), ['adversarial', 'ops', 'qa', 'security', 'tests'])
  assert.deepEqual(result.lensesSkipped.map(s => s.lens).sort(), ['concurrency', 'contract', 'observability'])
})

test('a failed selector means every lens runs', async () => {
  const { result, calls } = await run(base, world({ select: () => null }))
  assert.equal(lensesRun(calls).length, 8)
  assert.deepEqual(result.lensesSkipped, [])
})

test('unknown lenses from the selector are ignored', async () => {
  const { calls } = await run(base, world({ select: () => ({ lenses: ['bogus; rm'], skipped: [] }) }))
  assert.deepEqual(lensesRun(calls), ['adversarial', 'qa', 'security', 'tests'])
})

test('all lenses skips the selector', async () => {
  const { calls } = await run({ ...base, allLenses: true }, world())
  assert.equal(calls.some(c => c.label === 'select lenses'), false)
  assert.equal(lensesRun(calls).length, 8)
})

test('lenses use plugin-prefixed agents', async () => {
  const { calls } = await run(base, world())
  assert.equal(calls.find(c => c.label === 'lens qa').agentType, 'spec-deliver:qa-code-reviewer')
  assert.equal(calls.find(c => c.label === 'lens security').agentType, 'spec-deliver:security-reviewer')
})

test('reviewers are told allow rules match single commands', async () => {
  const { calls } = await run(base, world())
  assert.match(calls.find(c => c.label === 'lens tests').prompt, /one command per Bash call/i)
})

test('ponytail runs only when asked', async () => {
  const off = await run(base, world())
  assert.equal(lensesRun(off.calls).includes('ponytail'), false)
  const on = await run({ ...base, ponytail: true }, world())
  assert.equal(lensesRun(on.calls).includes('ponytail'), true)
})

test('a failed lens is flagged, not dropped silently', async () => {
  const { result } = await run(base, world({ lens: { security: () => null } }))
  assert.deepEqual(result.failedLenses, ['security'])
})

test('a failed lens makes the verdict incomplete, even with no findings', async () => {
  const { result } = await run(base, world({ lens: { security: () => null } }))
  assert.equal(result.verdict, 'INCOMPLETE')
})

test('refuted findings are removed and counted', async () => {
  const { result } = await run(base, world({
    lens: { qa: () => report([finding()]) },
    verify: () => ({ verdicts: [{ index: 0, real: false, reason: 'guarded on line 8', duplicateOf: null }] }),
  }))
  assert.equal(result.findings.length, 0)
  assert.equal(result.refuted, 1)
  assert.equal(result.verdict, 'CLEAN')
})

test('a failed verifier keeps the finding, marked unverified', async () => {
  const { result } = await run(base, world({ lens: { qa: () => report([finding()]) }, verify: () => null }))
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].verified, false)
})

test('a verifier that skips a finding keeps it, marked unverified', async () => {
  const { result } = await run(base, world({ lens: { qa: () => report([finding()]) }, verify: () => ({ verdicts: [] }) }))
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].verified, false)
})

test('nearby findings go to one verifier, which merges duplicates', async () => {
  const { result, calls } = await run(base, world({
    lens: {
      qa: () => report([finding({ severity: 'Medium', line: 10 })]),
      security: () => report([finding({ severity: 'Critical', line: 12 })]),
    },
    verify: () => ({ verdicts: [{ index: 0, real: true, reason: 'y', duplicateOf: null }, { index: 1, real: true, reason: 'y', duplicateOf: 0 }] }),
  }))
  assert.equal(calls.filter(c => c.label.startsWith('verify')).length, 1)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].severity, 'Critical')
  assert.deepEqual(result.findings[0].lenses.sort(), ['qa', 'security'])
})

test('distant findings in one file are verified separately', async () => {
  const { calls } = await run(base, world({
    lens: { qa: () => report([finding({ line: 10 }), finding({ line: 200 })]) },
  }))
  assert.equal(calls.filter(c => c.label.startsWith('verify')).length, 2)
})

test('low and info findings skip verification', async () => {
  const { result, calls } = await run(base, world({ lens: { qa: () => report([finding({ severity: 'Low' }), finding({ severity: 'Info', line: 99 })]) } }))
  assert.equal(calls.some(c => c.label.startsWith('verify')), false)
  assert.equal(result.findings.length, 2)
  assert.equal(result.findings.every(f => f.verified === false), true)
})

test('findings over the verify cap are kept and counted, most severe verified first', async () => {
  const many = Array.from({ length: 5 }, (_, i) => finding({ severity: i === 4 ? 'Critical' : 'Medium', file: `f${i}.ts` }))
  const { result, calls } = await run({ ...base, maxVerify: 2 }, world({ lens: { qa: () => report(many) } }))
  assert.equal(calls.filter(c => c.label.startsWith('verify')).length, 2)
  assert.equal(result.findings.length, 5)
  assert.equal(result.unverifiedOverCap, 3)
  assert.equal(result.findings.find(f => f.severity === 'Critical').verified, true)
})

test('findings sort by severity and set the verdict', async () => {
  const { result } = await run(base, world({
    lens: { qa: () => report([finding({ severity: 'Medium', file: 'b.ts' }), finding({ severity: 'High', file: 'c.ts' }), finding({ severity: 'Low', file: 'a.ts' })]) },
  }))
  assert.deepEqual(result.findings.map(f => f.severity), ['High', 'Medium', 'Low'])
  assert.equal(result.verdict, 'HIGH')
})

test('files no lens reviewed are reported', async () => {
  const only = call => report([], { filesReviewed: ['a.ts'] })
  const lens = Object.fromEntries(['qa', 'adversarial', 'security', 'tests', 'concurrency', 'observability', 'contract', 'ops'].map(l => [l, only]))
  const { result } = await run(base, world({ lens }))
  assert.deepEqual(result.uncoveredFiles, ['b.ts'])
})

test('a failed lens still leaves an accurate coverage map', async () => {
  const { result } = await run({ ...base, allLenses: true }, world({
    lens: Object.fromEntries(['qa', 'adversarial', 'security', 'tests', 'concurrency', 'observability', 'contract', 'ops'].map(l => [l, () => null])),
  }))
  assert.deepEqual(result.uncoveredFiles, ['a.ts', 'b.ts'])
  assert.equal(result.status, 'complete')
})

test('the test suite result comes from the tests lens', async () => {
  const { result } = await run(base, world({ lens: { tests: () => report([], { testSuite: 'PASS 12' }) } }))
  assert.equal(result.testSuite, 'PASS 12')
})

test('a clean diff needs no verification', async () => {
  const { result, calls } = await run(base, world())
  assert.equal(calls.some(c => c.label.startsWith('verify')), false)
  assert.equal(result.verdict, 'CLEAN')
})
