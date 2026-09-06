import { API_URL } from '../config'

export async function fetchTrainingVideos() {
  const response = await fetch(`${API_URL}/training-videos`)

  if (!response.ok) {
    throw new Error(`Failed to load training videos (${response.status})`)
  }

  return response.json()
}

export async function createTrainingVideo(video) {
  const response = await fetch(`${API_URL}/training-videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(video)
  })

  if (!response.ok) {
    throw new Error(`Failed to create training video (${response.status})`)
  }

  return response.json()
}

export async function updateTrainingVideo(id, video) {
  const response = await fetch(`${API_URL}/training-videos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(video)
  })

  if (!response.ok) {
    throw new Error(`Failed to update training video (${response.status})`)
  }

  return response.json()
}

export async function deleteTrainingVideo(id) {
  const response = await fetch(`${API_URL}/training-videos/${id}`, {
    method: 'DELETE'
  })

  if (!response.ok) {
    throw new Error(`Failed to delete training video (${response.status})`)
  }

  return response.json()
}

// `orderedIds` is the full list of video IDs in their new display order.
export async function reorderTrainingVideos(orderedIds) {
  const response = await fetch(`${API_URL}/training-videos/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ordered_ids: orderedIds })
  })

  if (!response.ok) {
    throw new Error(`Failed to reorder training videos (${response.status})`)
  }

  return response.json()
}
