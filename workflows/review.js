export const meta = {
  name: 'review',
  description: 'Review a diff through specialist lenses, verify each finding against the code, then dedup and rank',
  whenToUse: 'Started by /spec-deliver:parallel-review, which supplies the base and the changed files.',
  phases: [
    { title: 'Select', detail: 'choose lenses for this diff' },
    { title: 'Review', detail: 'specialist lenses in parallel' },
    { title: 'Verify', detail: 'try to refute each finding against the code' },
  ],
}

const SAFE_REF = /^[A-Za-z0-9._\/-]+$/
const CORE_LENSES = ['qa', 'adversarial', 'security', 'tests']
const OPTIONAL_LENSES = {
  concurrency: 'async work, threads, locks, queues, retries, shared state, or ordering',
  observability: 'logging, metrics, tracing, error handling, or new failure modes',
  contract: 'APIs, schemas, wire formats, env vars, or exported signatures',
  ops: 'deploys, migrations, feature flags, containers, CI, or infrastructure',
}
const AGENTS = { qa: 'qa-code-reviewer' }
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info']
const NEARBY_LINES = 3

const input = args || {}
const files = input.files

if (!SAFE_REF.test(input.base || '') || !Array.isArray(files) || files.length === 0) {
  return { status: 'refused', reason: 'needs a valid base and a list of changed files. Start through /spec-deliver:parallel-review.' }
}

const { base, branch, stats = '' } = input
const maxVerify = input.maxVerify ?? 40

const SELECT_SCHEMA = {
  type: 'object',
  required: ['lenses', 'skipped'],
  properties: {
    lenses: { type: 'array', items: { type: 'string' } },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        required: ['lens', 'reason'],
        properties: { lens: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
}
const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings', 'filesReviewed', 'positives'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'title', 'file', 'line', 'evidence', 'scenario', 'impact', 'suggestion'],
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          evidence: { type: 'string' },
          scenario: { type: 'string' },
          impact: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
    filesReviewed: { type: 'array', items: { type: 'string' } },
    positives: { type: 'array', items: { type: 'string' } },
    testSuite: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'real', 'reason', 'duplicateOf'],
        properties: {
          index: { type: 'number' },
          real: { type: 'boolean' },
          reason: { type: 'string' },
          duplicateOf: { type: ['number', 'null'] },
        },
      },
    },
  },
}

// Selection may only narrow the optional lenses, and any doubt runs them.
async function chooseLenses() {
  const optional = Object.keys(OPTIONAL_LENSES)
  if (input.allLenses) return { chosen: optional, skipped: [] }

  phase('Select')
  const descriptions = optional.map(lens => `- ${lens}: ${OPTIONAL_LENSES[lens]}`).join('\n')
  const selection = await agent(
    `Read the diff with \`git diff ${base}...HEAD\`. Decide which of these review lenses apply to it:

${descriptions}

Include a lens if the diff touches its area at all. When unsure, include it. Give a one-line reason for each lens you skip.`,
    { label: 'select lenses', model: 'haiku', effort: 'low', schema: SELECT_SCHEMA, phase: 'Select' },
  )
  if (!selection) return { chosen: optional, skipped: [] }

  const chosen = optional.filter(lens => selection.lenses.includes(lens))
  const reasons = new Map(selection.skipped.map(entry => [entry.lens, entry.reason]))
  const skipped = optional
    .filter(lens => !chosen.includes(lens))
    .map(lens => ({ lens, reason: reasons.get(lens) || 'not selected' }))
  return { chosen, skipped }
}

const { chosen, skipped: lensesSkipped } = await chooseLenses()
const lenses = [...CORE_LENSES, ...chosen]

const reviewPrompt = `Review the diff between \`${base}\` and \`HEAD\` on branch \`${branch}\` in the current directory.

Diff size: ${stats || `${files.length} files`}

Follow your prompt: apply the exhaustiveness mandate, the diff-walk loop and the final re-read. Findings only, do not modify code.
Return every finding, list each file you reviewed in filesReviewed, and put what is done well in positives.`

const ponytailPrompt = `Invoke the Skill tool with skill \`ponytail:ponytail-review\` to review the diff between \`${base}\` and \`HEAD\` on branch \`${branch}\`. Findings only, do not modify code.
Report its Must fix findings as High, Should fix as Medium, and Nice to have as Low. List each file you reviewed in filesReviewed.`

const runLens = lens => {
  if (lens === 'ponytail') {
    return agent(ponytailPrompt, { label: 'lens ponytail', agentType: 'general-purpose', schema: FINDINGS_SCHEMA, phase: 'Review' })
  }
  const suiteNote = lens === 'tests' ? '\n\nRun the test suite and put the result in testSuite.' : ''
  return agent(`${reviewPrompt}${suiteNote}`, {
    label: `lens ${lens}`,
    agentType: `spec-deliver:${AGENTS[lens] || `${lens}-reviewer`}`,
    schema: FINDINGS_SCHEMA,
    phase: 'Review',
  })
}

phase('Review')
const allLenses = input.ponytail ? [...lenses, 'ponytail'] : lenses
const reports = await parallel(allLenses.map(lens => () => runLens(lens)))

const failedLenses = allLenses.filter((_, index) => !reports[index])
const raw = []
const reviewed = new Set()
const positives = new Set()
let testSuite = null

reports.forEach((report, index) => {
  if (!report) return
  const lens = allLenses[index]
  report.findings.forEach(finding => raw.push({ ...finding, lenses: [lens], verified: false }))
  report.filesReviewed.forEach(file => reviewed.add(file))
  report.positives.forEach(positive => positives.add(positive))
  if (lens === 'tests' && report.testSuite) testSuite = report.testSuite
})

const rank = finding => {
  const position = SEVERITIES.indexOf(finding.severity)
  return position === -1 ? SEVERITIES.length : position
}
const needsVerifying = finding => rank(finding) <= SEVERITIES.indexOf('Medium')

// Findings close together in one file may be the same issue, so one verifier sees them all.
function cluster(findings) {
  const clusters = []
  const sorted = [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  for (const finding of sorted) {
    const last = clusters[clusters.length - 1]
    const previous = last && last[last.length - 1]
    if (previous && previous.file === finding.file && finding.line - previous.line <= NEARBY_LINES) last.push(finding)
    else clusters.push([finding])
  }
  return clusters.sort((a, b) => Math.min(...a.map(rank)) - Math.min(...b.map(rank)))
}

const clusters = cluster(raw.filter(needsVerifying))
const toVerify = clusters.slice(0, maxVerify)
const overCap = clusters.slice(maxVerify).flat()
if (overCap.length > 0) log(`${overCap.length} findings were over the verify cap of ${maxVerify} and stay unverified`)

function verifyPrompt(findings) {
  const listing = findings
    .map((finding, index) => `[${index}] ${finding.severity}: ${finding.title} at ${finding.file}:${finding.line}\nEvidence: ${finding.evidence}\nScenario: ${finding.scenario}`)
    .join('\n\n')
  return `Check these findings from a review of \`${base}...HEAD\` against the code.\n\n${listing}\n\nINDEXES:${JSON.stringify(findings.map((_, index) => index))}`
}

// Returns the findings that survive. Anything the verifier did not rule on stays, unverified.
function applyVerdicts(findings, result) {
  const verdicts = new Map((result ? result.verdicts : []).map(verdict => [verdict.index, verdict]))
  const kept = new Map()
  let refuted = 0

  findings.forEach((finding, index) => {
    const verdict = verdicts.get(index)
    if (!verdict) {
      kept.set(index, finding)
      return
    }
    if (!verdict.real) {
      refuted += 1
      return
    }
    const target = verdict.duplicateOf === null ? undefined : kept.get(verdict.duplicateOf)
    if (target) {
      target.lenses = [...new Set([...target.lenses, ...finding.lenses])]
      if (rank(finding) < rank(target)) target.severity = finding.severity
      return
    }
    kept.set(index, { ...finding, verified: true, verification: verdict.reason })
  })
  return { kept: [...kept.values()], refuted }
}

let refuted = 0
const confirmed = []

if (toVerify.length > 0) {
  phase('Verify')
  const verdicts = await parallel(toVerify.map((findings, index) => () => agent(verifyPrompt(findings), {
    label: `verify ${index + 1}`,
    agentType: 'spec-deliver:finding-verifier',
    schema: VERIFY_SCHEMA,
    phase: 'Verify',
  })))
  toVerify.forEach((findings, index) => {
    const outcome = applyVerdicts(findings, verdicts[index])
    refuted += outcome.refuted
    confirmed.push(...outcome.kept)
  })
}

const findings = [...confirmed, ...overCap, ...raw.filter(finding => !needsVerifying(finding))]
  .sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file) || a.line - b.line)

return {
  status: 'complete',
  base,
  branch,
  verdict: findings.length > 0 ? findings[0].severity.toUpperCase() : 'CLEAN',
  findings,
  refuted,
  unverifiedOverCap: overCap.length,
  testSuite,
  lensesRun: allLenses.filter(lens => !failedLenses.includes(lens)),
  lensesSkipped,
  failedLenses,
  uncoveredFiles: files.filter(file => !reviewed.has(file)),
  positives: [...positives],
}
