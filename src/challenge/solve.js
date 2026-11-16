import { findNumber } from './sha256.js'

const CHUNK = 4000

// Finds the number of a challenge: in a Web Worker when the browser has one, else on the page in small chunks (the page stays usable).
export function solveChallenge(ch) {
  return new Promise((resolve, reject) => {
    if (typeof Worker !== 'undefined') {
      try {
        const worker = new Worker(new URL('./powWorker.js', import.meta.url), { type: 'module' })
        worker.onmessage = (event) => { worker.terminate(); if (event.data.number == null) reject(new Error('unsolved')); else resolve(event.data.number) }
        worker.onerror = () => { worker.terminate(); solveHere(ch).then(resolve, reject) }
        worker.postMessage({ salt: ch.salt, challenge: ch.challenge, max: ch.max })
        return
      } catch { /* no worker: it is solved on the page */ }
    }
    solveHere(ch).then(resolve, reject)
  })
}

export async function solveHere(ch) {
  for (let from = 0; from <= ch.max; from += CHUNK) {
    const found = findNumber(ch, from, Math.min(ch.max, from + CHUNK - 1))
    if (found != null) return found
    await new Promise(next => setTimeout(next, 0))
  }
  throw new Error('unsolved')
}
