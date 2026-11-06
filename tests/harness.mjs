// Runs a workflow script with fake runtime hooks, so its control flow can be tested without a model.
import { readFileSync } from 'node:fs'

const AsyncFunction = (async () => {}).constructor

export function load(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  if (!source.startsWith('export const meta = {')) throw new Error('meta must be the first statement')
  const body = source.replace('export const meta =', 'const meta =')
  const script = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', body)

  return async (args, respond, { spent = () => 0 } = {}) => {
    const calls = []
    const agent = async (prompt, opts = {}) => {
      calls.push({ prompt, ...opts })
      return respond({ prompt, ...opts }, calls)
    }
    const parallel = async thunks => Promise.all(thunks.map(t => t().catch(() => null)))
    const budget = { total: null, spent, remaining: () => Infinity }
    const result = await script(agent, parallel, null, () => {}, () => {}, args, budget)
    return { result, calls }
  }
}
