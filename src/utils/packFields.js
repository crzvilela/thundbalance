// The text a studio writes about a pack: its objective and its list of benefits (Admin > Packs), and the rules they follow.
// The server checks them again (backend/pack_catalog.py); these functions only give the form a fast answer. The two sets of
// limits must be the same.

export const MAX_OBJECTIVE = 160
export const MAX_BENEFITS = 8
export const MAX_BENEFIT = 80

const hasMarkup = (text) => /[<>]/.test(text) || [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const tidy = (text) => String(text ?? '').split(/\s+/).filter(Boolean).join(' ')

// '' when the objective is fine, otherwise the key of the admin text that explains the problem.
export function objectiveProblem(text) {
  const value = tidy(text)
  if (value.length > MAX_OBJECTIVE) return 'cat_err_objective_len'
  if (hasMarkup(value)) return 'cat_err_objective_html'
  return ''
}

// The first problem of a list of benefits (blank lines are ignored: they are dropped on save).
export function benefitsProblem(list) {
  const seen = new Set()
  let count = 0
  for (const entry of list || []) {
    const value = tidy(entry)
    if (!value) continue
    if (value.length > MAX_BENEFIT) return 'cat_err_benefit_len'
    if (hasMarkup(value)) return 'cat_err_benefit_html'
    if (seen.has(value.toLowerCase())) return 'cat_err_benefit_dup'
    seen.add(value.toLowerCase())
    count += 1
  }
  return count > MAX_BENEFITS ? 'cat_err_benefit_max' : ''
}

// What is sent: tidied texts, no blank benefit.
export const cleanObjective = (text) => tidy(text)
export const cleanBenefits = (list) => (list || []).map(tidy).filter(Boolean)

// Moves one item of a list one place up (-1) or down (+1); out of range returns the same list.
export function moveItem(list, index, step) {
  const target = index + step
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
