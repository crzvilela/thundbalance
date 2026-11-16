// Runs in a Web Worker of the site itself (worker-src 'self'): the page never freezes while the proof of work is found.
import { findNumber } from './sha256.js'

self.onmessage = (event) => {
  const { salt, challenge, max } = event.data
  self.postMessage({ number: findNumber({ salt, challenge, max }) })
}
