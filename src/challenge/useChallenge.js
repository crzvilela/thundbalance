import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_URL } from '../config'
import { MIN_AGE_MS, RENEW_AFTER_MS, obtainSolution, supported } from './challenge.js'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// The anti-robot challenge of one form. `state`: idle | checking | ready | error | unsupported.
//   start()     begins to look for the solution in the background (call it when the form is shown, or on the first interaction)
//   solution()  a promise with the solution to send in the form's `challenge` field (waits for it, and never hands it out before the
//               server would accept it: a solution younger than 2.5 s is held back)
//   spent()     the solution was used (or refused): the next solution() prepares a new one
//   retry()     the "Retry" button after an error
export function useChallenge({ auto = false } = {}) {
  const [state, setState] = useState('idle')
  const current = useRef(null)
  const renew = useRef(null)
  const alive = useRef(true)
  const again = useRef(() => {})                  // starts a new solution (set below: the timer of a solution needs it)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; clearTimeout(renew.current) }
  }, [])

  const show = useCallback((next) => { if (alive.current) setState(next) }, [])

  const begin = useCallback(() => {
    if (current.current) return current.current.promise
    if (!supported()) {
      show('unsupported')
      return Promise.reject(new Error('unsupported'))
    }
    show('checking')
    const entry = {}
    entry.promise = obtainSolution(API_URL).then((result) => {
      entry.result = result
      if (current.current === entry) {
        show('ready')
        clearTimeout(renew.current)
        // a form left open for long gets a new solution before this one expires (nobody notices)
        renew.current = setTimeout(() => { if (current.current === entry) { current.current = null; again.current() } }, RENEW_AFTER_MS)
      }
      return result
    }, (error) => {
      if (current.current === entry) current.current = null
      show('error')
      throw error
    })
    current.current = entry
    return entry.promise
  }, [show])

  const start = useCallback(() => { begin().catch(() => {}) }, [begin])
  useEffect(() => { again.current = start }, [start])

  const solution = useCallback(async () => {
    const result = await begin()
    const wait = MIN_AGE_MS - (Date.now() - result.readyAt)
    if (wait > 0) await sleep(wait)
    return result.payload
  }, [begin])

  const spent = useCallback(() => {
    current.current = null
    clearTimeout(renew.current)
    show('idle')
  }, [show])

  const retry = useCallback(() => { current.current = null; start() }, [start])

  useEffect(() => { if (auto) start() }, [auto, start])

  return useMemo(() => ({ state, start, solution, spent, retry }), [state, start, solution, spent, retry])
}
