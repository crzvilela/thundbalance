// SHA-256 in plain JavaScript, synchronous and allocation-light: the proof of work tries tens of thousands of numbers and
// crypto.subtle.digest is asynchronous (a promise per try), which is much slower. Tested against crypto.subtle (challenge.test.js).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])
const W = new Uint32Array(64)
const state = new Uint32Array(8)

function block(data, offset) {
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4
    W[i] = (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3]
  }
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15]
    const b = W[i - 2]
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0
  }
  let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7]
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
  }
  state[0] += a; state[1] += b; state[2] += c; state[3] += d; state[4] += e; state[5] += f; state[6] += g; state[7] += h
}

/** SHA-256 of an ASCII string as 8 words (the returned array is reused by the next call). */
export function sha256Words(text) {
  const length = text.length
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6)
  for (let i = 0; i < length; i++) padded[i] = text.charCodeAt(i) & 0xff
  padded[length] = 0x80
  const bits = length * 8
  padded[padded.length - 4] = (bits >>> 24) & 0xff
  padded[padded.length - 3] = (bits >>> 16) & 0xff
  padded[padded.length - 2] = (bits >>> 8) & 0xff
  padded[padded.length - 1] = bits & 0xff
  state.set([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  for (let offset = 0; offset < padded.length; offset += 64) block(padded, offset)
  return state
}

export function sha256Hex(text) {
  return Array.from(sha256Words(text), word => (word >>> 0).toString(16).padStart(8, '0')).join('')
}

export function hexToWords(hex) {
  const words = new Uint32Array(8)
  for (let i = 0; i < 8; i++) words[i] = parseInt(hex.slice(i * 8, i * 8 + 8), 16)
  return words
}

/** The number n in from..to whose SHA-256(salt + n) is `challenge`, or null. */
export function findNumber({ salt, challenge, max }, from = 0, to = max) {
  const target = hexToWords(challenge)
  for (let n = from; n <= to; n++) {
    const words = sha256Words(salt + n)
    if (words[0] === target[0] && words[1] === target[1] && words[2] === target[2] && words[3] === target[3]
      && words[4] === target[4] && words[5] === target[5] && words[6] === target[6] && words[7] === target[7]) return n
  }
  return null
}
