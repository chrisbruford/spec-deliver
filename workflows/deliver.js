export const meta = {
  name: 'deliver',
  description: 'Deliver an approved change group by group: failing tests, implementation, gate, review',
  whenToUse: 'Started by /spec-deliver:spec-deliver after human approval. Refuses to run without an approved commit.',
  phases: [
    { title: 'Preflight', detail: 'check gate state and a green baseline' },
    { title: 'Deliver', detail: 'per group: red, green, gate, review, accept' },
  ],
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/
const SAFE_CHANGE = /^[A-Za-z0-9._-]+$/
const SAFE_SHA = /^[0-9a-f]{7,40}$/
const KINDS = ['code', 'no-test', 'refactor']
const MAX_RETRIES = 2

const input = args || {}
const groups = input.groups

const refusal = (() => {
  if (!SAFE_SHA.test(input.approvedSha || '')) return 'missing or invalid approvedSha'
  if (input.change !== undefined && !SAFE_CHANGE.test(input.change)) return 'invalid change name'
  if (input.change === undefined && !input.brief) return 'needs a change or a brief'
  if (!Array.isArray(groups) || groups.length === 0) return 'no groups to deliver'
  for (const group of groups) {
    if (!SAFE_ID.test(group.id || '')) return `invalid group id: ${group.id}`
    if (!KINDS.includes(group.kind)) return `invalid group kind: ${group.kind}`
  }
  return null
})()

if (refusal) {
  return { status: 'refused', reason: `${refusal}. Start delivery through /spec-deliver:spec-deliver.` }
}

const approved = input.approvedSha
const change = input.change
const maxAgents = input.maxAgents ?? groups.length * 15 + 5
const maxOutputTokens = input.maxOutputTokens ?? null

const GATE_SCHEMA = {
  type: 'object',
  required: ['exit', 'resultLine', 'tail'],
  properties: {
    exit: { type: 'number' },
    resultLine: { type: 'string' },
    tail: { type: 'string' },
  },
}
const WORK_SCHEMA = {
  type: 'object',
  required: ['head', 'blocked'],
  properties: {
    head: { type: 'string' },
    blocked: { type: 'string' },
  },
}
const REVIEW_SCHEMA = {
  type: 'object',
  required: ['blocking', 'notes'],
  properties: {
    blocking: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
}

const stop = (reason, group, detail = '') => ({ stopped: true, reason, group, detail })

let spawned = 0

async function run(prompt, opts) {
  if (spawned >= maxAgents) throw stop('agent-cap', null, `reached ${maxAgents} agents`)
  if (maxOutputTokens !== null && budget.spent() >= maxOutputTokens) {
    throw stop('token-cap', null, `reached ${maxOutputTokens} output tokens`)
  }
  spawned += 1
  const result = await agent(prompt, opts)
  if (result === null || result === undefined) throw stop(`agent-failed:${opts.label}`, null)
  return result
}

async function gate(mode, group, extra = '') {
  const parts = ['spec-deliver-gate', mode, '--approved', approved]
  if (group) parts.push('--group', group.id)
  const command = `${parts.join(' ')}${extra}`
  const report = await run(`Run this one command and report the result:\n\n${command}`, {
    label: `gate ${mode} ${group ? group.id : ''}`.trim(),
    agentType: 'spec-deliver:gate-runner',
    schema: GATE_SCHEMA,
    phase: group ? 'Deliver' : 'Preflight',
  })
  const line = report.resultLine || ''
  const ok = report.exit === 0 && line.startsWith(`GATE ${mode} PASS`)
  return { ok, line, tail: report.tail || '' }
}

const headOf = line => /head=(\S+)/.exec(line)?.[1] ?? ''
const sameCommit = (a, b) => Boolean(a && b) && (a.startsWith(b) || b.startsWith(a))

const groundRules = `Working rules:
- Use the Write and Edit tools for files.
- Run one command per Bash call, with no && chaining, pipes or redirects. Allow rules match single commands.
- Commit your work. The gate checks HEAD and fails on uncommitted changes.
- Stay in scope. Small fixes in your path are welcome. Cross-cutting refactors are not.`

const source = change
  ? `Read the approved change in openspec/changes/${change}/: proposal.md, design.md, tasks.md and specs/.`
  : `The approved brief:\n\n${input.brief}`

const constraints = input.constraints ? `\n\nConstraints from the proposal and design:\n${input.constraints}` : ''

const groupBrief = group => `${source}

You are working on group ${group.id}: ${group.title}.${constraints}`

async function writeTests(group) {
  let feedback = ''
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const work = await run(
      `${groupBrief(group)}

Write the failing tests for this group, and nothing else. Each spec scenario in the group needs a test that proves it.
Do not write production logic. On compiled stacks, commit minimal signature stubs so the tests compile and fail on an assertion rather than a missing symbol.
If repo pre-commit hooks reject failing tests, --no-verify is allowed on this commit only.

Make exactly one commit, with this trailer:
git commit --no-verify -m "test: <summary>" -m "Red-For: ${group.id}"

${groundRules}${feedback}

Return the short HEAD sha. Set blocked to a reason if you cannot proceed, otherwise an empty string.`,
      { label: `test-writer ${group.id}`, schema: WORK_SCHEMA, phase: 'Deliver' },
    )
    if (work.blocked) throw stop('blocked', group.id, work.blocked)

    const red = await gate('red', group)
    if (red.ok) return
    if (red.line.includes('passes-at-red')) {
      throw stop('passes-at-red', group.id, 'The new tests already pass, so this group may be done or the tests prove nothing.')
    }
    feedback = `\n\nThe previous attempt failed the red gate:\n${red.line}\n${red.tail}`
  }
  throw stop('red-failed', group.id, feedback)
}

async function implement(group, startHead) {
  const taskFlags = group.kind === 'code' ? '' : group.kind === 'refactor' ? ` --no-test --since ${startHead}` : ' --no-test'
  const goal = group.kind === 'code'
    ? 'Make the failing tests for this group pass with the minimum real code. No placeholders or stubs.'
    : group.kind === 'refactor'
      ? 'Do this refactor without changing behaviour. Test files must not change.'
      : 'Do this work. It has no tests of its own, and the repo verify commands must still pass.'
  let feedback = ''

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const work = await run(
      `${groupBrief(group)}

${goal}
Search before you write: do not assume code does not exist.
Never edit test files, specs, proposal.md, design.md, .config/spec-deliver/verify, CI config or test runner config. The gate fails on any of these.
If a test looks wrong, do not change it. Set blocked to the reason, and a human will decide.
Fix forward with new commits. Never rewrite history: no reset, rebase or amend.

${groundRules}${feedback}

Return the short HEAD sha. Set blocked to a reason if you cannot proceed, otherwise an empty string.`,
      { label: `implement ${group.id}`, schema: WORK_SCHEMA, phase: 'Deliver' },
    )
    if (work.blocked) throw stop('blocked', group.id, work.blocked)

    const task = await gate('task', group, taskFlags)
    if (!task.ok) {
      feedback = `\n\nThe previous attempt failed the gate:\n${task.line}\n${task.tail}`
      continue
    }
    if (!sameCommit(work.head, headOf(task.line))) {
      feedback = `\n\nThe gate ran at head ${headOf(task.line)} but you reported ${work.head}.`
      continue
    }

    const review = await run(
      `${groupBrief(group)}

Review the diff ${startHead}..HEAD for this group. This is one independent check before the group is accepted, not the full review.
Run git rev-parse --absolute-git-dir, then read spec-deliver/${group.id}.red.log under that directory if it exists, and confirm the tests failed for the right reason.
Report as blocking only what must change before acceptance: a spec scenario with no real test, a vacuous or hardcoded test, code built only to satisfy a test, wrong behaviour, or a weakened test command in a manifest such as package.json.
Do not report style.`,
      { label: `review ${group.id}`, agentType: 'spec-deliver:qa-code-reviewer', schema: REVIEW_SCHEMA, phase: 'Deliver' },
    )
    if (review.blocking.length === 0) return review.notes
    feedback = `\n\nThe reviewer blocked acceptance:\n- ${review.blocking.join('\n- ')}`
  }
  throw stop('retries-exhausted', group.id, feedback)
}

function acceptFlags(group) {
  const change_ = change ? ` --change ${change}` : ''
  if (group.kind === 'code') return change_
  return `${change_} --no-test ${group.kind === 'refactor' ? 'refactor-group' : 'no-test-group'}`
}

const delivered = []
const skipped = []
const notes = []
let baselineChecked = false

try {
  for (const group of groups) {
    phase('Preflight')
    const status = await gate('status', group)
    const state = /state=(\S+)/.exec(status.line)?.[1]
    if (!status.ok || !state) throw stop('status-failed', group.id, status.line)
    if (state === 'green') {
      skipped.push(group.id)
      continue
    }

    // A resumed group is red on purpose, so only a fresh start can demand a green baseline.
    if (state === 'none' && !baselineChecked) {
      const baseline = await gate('baseline')
      if (!baseline.ok) throw stop('baseline-failed', group.id, `${baseline.line}\n${baseline.tail}`)
    }
    baselineChecked = true

    phase('Deliver')
    const startHead = headOf(status.line)
    if (group.kind === 'code') {
      if (state === 'none') {
        await writeTests(group)
      } else if (state === 'red-unchecked') {
        const red = await gate('red', group)
        if (!red.ok) throw stop('red-failed', group.id, `${red.line}\n${red.tail}`)
      }
    }

    const reviewNotes = await implement(group, startHead)
    notes.push(...reviewNotes.map(note => `group ${group.id}: ${note}`))

    const accepted = await gate('accept', group, acceptFlags(group))
    if (!accepted.ok) throw stop('accept-failed', group.id, `${accepted.line}\n${accepted.tail}`)
    delivered.push(group.id)
    log(`Group ${group.id} accepted`)
  }
} catch (failure) {
  if (!failure || !failure.stopped) throw failure
  return { status: 'stopped', reason: failure.reason, group: failure.group, detail: failure.detail, delivered, skipped, notes, agents: spawned }
}

return { status: 'complete', delivered, skipped, notes, agents: spawned }
