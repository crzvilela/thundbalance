// The visitor's choice about cookies and external content: what is stored, how it is read. Pure (no React, no window): consentCore.test.js.
// Stored in this browser only: { v: version of the categories, at: date of the choice, external: true | false }.
// The necessary category is always on and is not stored. When the categories change, CONSENT_VERSION goes up and everybody is asked again.
export const CONSENT_KEY = 'tb_cookie_consent'
export const CONSENT_VERSION = 2
export const CATEGORIES = ['external']             // what can be switched on or off (everything else is necessary)

/** The stored text -> the choice, or null (no choice, damaged, or an older version of the categories). */
export function parseConsent(raw) {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || data.v !== CONSENT_VERSION) return null
    const choice = { v: data.v, at: typeof data.at === 'string' ? data.at.slice(0, 30) : '' }
    for (const name of CATEGORIES) choice[name] = data[name] === true
    return choice
  } catch {
    return null
  }
}

/** The choice to store. Only known categories, only true/false. */
export function buildConsent(choices = {}, now = new Date()) {
  const choice = { v: CONSENT_VERSION, at: now.toISOString() }
  for (const name of CATEGORIES) choice[name] = choices[name] === true
  return choice
}

export const acceptAll = () => Object.fromEntries(CATEGORIES.map(name => [name, true]))
export const rejectAll = () => Object.fromEntries(CATEGORIES.map(name => [name, false]))

/** Is a category allowed by this choice? Without a choice nothing optional is allowed. */
export const allows = (choice, category) => Boolean(choice && choice[category] === true)
