import { API_URL } from '../config'

export async function fetchLandingContent(version = 'published') {
  const response = await fetch(`${API_URL}/landing-page/content?version=${version}`)

  if (!response.ok) {
    throw new Error(`Failed to load landing page content (${response.status})`)
  }

  return response.json()
}

export async function saveDraftContent(content) {
  const response = await fetch(`${API_URL}/landing-page/content/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  })

  if (!response.ok) {
    throw new Error(`Failed to save draft (${response.status})`)
  }

  return response.json()
}

export async function publishContent(content) {
  const response = await fetch(`${API_URL}/landing-page/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  })

  if (!response.ok) {
    throw new Error(`Failed to publish (${response.status})`)
  }

  return response.json()
}

export async function resetLandingContent(version = 'draft') {
  const response = await fetch(`${API_URL}/landing-page/reset?version=${version}`, {
    method: 'POST'
  })

  if (!response.ok) {
    throw new Error(`Failed to reset (${response.status})`)
  }

  return response.json()
}

export async function uploadLandingImage(file) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_URL}/landing-page/upload-image`, {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    throw new Error(`Failed to upload image (${response.status})`)
  }

  const data = await response.json()
  return resolveImageUrl(data.url)
}

export async function uploadLandingVideo(file) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_URL}/landing-page/upload-video`, {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    throw new Error(`Failed to upload video (${response.status})`)
  }

  const data = await response.json()
  return resolveImageUrl(data.url)
}

// Resolves a stored image reference into something an <img> tag can use:
// - null/empty -> null (caller should fall back to the bundled default image)
// - already absolute (http/https/data) -> unchanged
// - relative ("/uploads/xxx") -> prefixed with the API base URL
export function resolveImageUrl(path) {
  if (!path) return null
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:')) return path
  return `${API_URL}${path}`
}
