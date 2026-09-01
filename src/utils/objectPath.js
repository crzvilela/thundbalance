// Tiny helpers to get/set/merge deeply nested values using a "a.b.c" path string.
// Kept dependency-free so the editor doesn't need lodash.

export function getPath(obj, path, fallback = undefined) {
  if (!path) return fallback
  const parts = Array.isArray(path) ? path : path.split('.')
  let cur = obj

  for (const part of parts) {
    if (cur === null || cur === undefined) return fallback
    cur = cur[part]
  }

  return cur === undefined ? fallback : cur
}

// Returns a NEW object with `value` set at `path`, only cloning the objects
// along the path (structural sharing for everything else).
export function setPath(obj, path, value) {
  const parts = Array.isArray(path) ? path : path.split('.')
  const rootClone = Array.isArray(obj) ? [...obj] : { ...(obj || {}) }

  let cur = rootClone

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    const existing = cur[key]
    cur[key] = Array.isArray(existing) ? [...existing] : { ...(existing || {}) }
    cur = cur[key]
  }

  cur[parts[parts.length - 1]] = value

  return rootClone
}

export function deepClone(value) {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

// Merges `override` on top of `base`, filling in any keys missing from
// override with the ones from base. Arrays in `override` fully replace
// arrays in `base` (so admins can add/remove list items like services).
export function deepMerge(base, override) {
  if (override === undefined || override === null) return base
  if (Array.isArray(base) || Array.isArray(override)) return override

  if (
    typeof base === 'object' && base !== null &&
    typeof override === 'object' && override !== null
  ) {
    const result = { ...base }

    for (const key of Object.keys(override)) {
      result[key] = key in base
        ? deepMerge(base[key], override[key])
        : override[key]
    }

    return result
  }

  return override
}
