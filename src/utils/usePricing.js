// The prices come from the server (GET /pricing) and the second person of a dual session is checked with the
// same rules as the other forms. Pure helpers (figures, money, request bodies) are in pricing.js.
import { useEffect, useState } from 'react'
import { API_URL } from '../config'
import { emailProblem, nameProblem } from './validators'

let pending = null

// One request for the whole app; a failure is not remembered (the next caller tries again).
export function loadPricing() {
  if (!pending) {
    pending = fetch(`${API_URL}/pricing`)
      .then(response => {
        if (!response.ok) throw new Error('pricing')
        return response.json()
      })
      .catch(error => {
        pending = null
        throw error
      })
  }
  return pending
}

// { prices, failed }: prices is null until they arrive.
export function usePricing() {
  const [state, setState] = useState({ prices: null, failed: false })
  useEffect(() => {
    let active = true
    loadPricing()
      .then(prices => { if (active) setState({ prices, failed: false }) })
      .catch(() => { if (active) setState({ prices: null, failed: true }) })
    return () => { active = false }
  }, [])
  return state
}

// The second person of a dual session: name and email are required (codes of src/i18n/formText.js, null = fine).
// An individual session has no second person.
export function secondPersonProblems({ type, name, email }) {
  if (type !== 'dual') return {}
  const found = {}
  const nameCode = nameProblem(name)
  if (nameCode) found.name = nameCode
  const emailCode = emailProblem(email)
  if (emailCode) found.email = emailCode
  return found
}

