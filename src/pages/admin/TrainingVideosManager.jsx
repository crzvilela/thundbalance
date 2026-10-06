import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import TrainingVideoPlayer from '../../components/TrainingVideoPlayer'
import ConfirmDialog from '../../components/editor/ConfirmDialog'
import {
  TextField,
  TextAreaField,
  ButtonRow,
  SmallButton
} from '../../components/editor/fields'
import {
  fetchTrainingVideos,
  createTrainingVideo,
  updateTrainingVideo,
  deleteTrainingVideo,
  reorderTrainingVideos
} from '../../api/trainingVideos'
import { uploadLandingVideo } from '../../api/landingPage'
import { useI18n } from '../../i18n/I18nContext'
import { resolveText } from '../../utils/multilingual'

// Upload-only — YouTube/Vimeo/Instagram Reel embeds were removed per request
// (kept things simpler for the admin, and avoided embed-related upload
// confusion). video_source is always 'upload' for anything created here now.
// Older videos already saved with a different source (if any) will still
// play fine on the public page (TrainingVideoPlayer still supports all
// sources) — they just can't be re-picked as youtube/vimeo/instagram when
// edited here anymore; re-uploading a file for them switches them to 'upload'.
const EMPTY_FORM = { title: '', description: '', video_source: 'upload', video_url: '' }

function TrainingVideosManager() {
  const { language } = useI18n()
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null) // null = closed, 'new' = creating, or a video id
  const [form, setForm] = useState(EMPTY_FORM)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const fileInputRef = useRef(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchTrainingVideos()
      setVideos(data)
    } catch (err) {
      console.error('Failed to load training videos:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const startCreate = () => {
    setForm(EMPTY_FORM)
    setEditingId('new')
  }

  const startEdit = (video) => {
    setForm({
      title: resolveText(video.title, language),
      description: resolveText(video.description, language),
      video_source: 'upload',
      video_url: video.video_source === 'upload' ? video.video_url : ''
    })
    setEditingId(video.id)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadLandingVideo(file)
      setForm((f) => ({ ...f, video_url: url }))
    } catch (err) {
      console.error(err)
      alert('Could not upload video. Please try a smaller file.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSave = async () => {
    if (!form.title.trim() || !form.video_url.trim()) {
      alert('Title and video are required.')
      return
    }

    setSaving(true)
    try {
      if (editingId === 'new') {
        await createTrainingVideo(form)
      } else {
        await updateTrainingVideo(editingId, form)
      }
      await load()
      cancelEdit()
    } catch (err) {
      console.error(err)
      alert('Could not save this video.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteTrainingVideo(deleteTarget)
      await load()
    } catch (err) {
      console.error(err)
      alert('Could not delete this video.')
    } finally {
      setDeleteTarget(null)
    }
  }

  const moveVideo = async (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= videos.length) return

    const next = [...videos]
    ;[next[index], next[target]] = [next[target], next[index]]
    setVideos(next)

    try {
      await reorderTrainingVideos(next.map((v) => v.id))
    } catch (err) {
      console.error(err)
      load() // out of sync with the server — reload the real order
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      <div className="p-6 md:p-10 pt-32 md:pt-36">
        <div className="max-w-5xl mx-auto">

          <Link to="/admin" className="text-sm text-gray-400 hover:text-white transition">
            ← Back to Admin
          </Link>

          <h1
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-4xl md:text-6xl mt-4 mb-10"
          >
            Training Videos
          </h1>

          {editingId ? (

            <div className="border border-white/10 rounded-2xl p-6 mb-10 max-w-lg">

              <h2 className="text-lg font-semibold mb-4">
                {editingId === 'new' ? 'Add Video' : 'Edit Video'}
              </h2>

              <TextField
                label="Title"
                value={form.title}
                onChange={(v) => setForm((f) => ({ ...f, title: v }))}
              />

              <TextAreaField
                label="Description"
                value={form.description}
                onChange={(v) => setForm((f) => ({ ...f, description: v }))}
              />

              <ButtonRow>
                <SmallButton onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : form.video_url ? 'Replace Video' : 'Upload Video'}
                </SmallButton>
              </ButtonRow>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={handleUpload}
              />
              {form.video_url && (
                <p className="text-[11px] text-emerald-400 mb-4">Video uploaded.</p>
              )}

              {form.video_url && (
                <div className="mb-4">
                  <TrainingVideoPlayer source="upload" url={form.video_url} />
                </div>
              )}

              <ButtonRow>
                <SmallButton variant="primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </SmallButton>
                <SmallButton onClick={cancelEdit}>
                  Cancel
                </SmallButton>
              </ButtonRow>

            </div>

          ) : (

            <button
              onClick={startCreate}
              className="mb-10 inline-flex items-center gap-2 border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 transition px-6 py-3 rounded-xl text-sm uppercase tracking-wider"
            >
              + Add Video
            </button>

          )}

          {loading ? (

            <p className="text-gray-400">Loading…</p>

          ) : videos.length === 0 ? (

            <p className="text-gray-400">No videos yet.</p>

          ) : (

            <div className="space-y-4">

              {videos.map((video, index) => (

                <div
                  key={video.id}
                  className="border border-white/10 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-start gap-5 overflow-hidden"
                >

                  <div className="w-24 shrink-0">
                    <TrainingVideoPlayer source={video.video_source} url={video.video_url} compact />
                  </div>

                  <div className="flex-1 min-w-0 w-full">
                    <p className="font-semibold truncate">{resolveText(video.title, language)}</p>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{video.video_source}</p>
                    {resolveText(video.description, language) && (
                      <p className="text-sm text-gray-400 leading-6 w-full [overflow-wrap:anywhere]">
                        {resolveText(video.description, language)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <SmallButton onClick={() => moveVideo(index, -1)} disabled={index === 0}>Up</SmallButton>
                    <SmallButton onClick={() => moveVideo(index, 1)} disabled={index === videos.length - 1}>Down</SmallButton>
                    <SmallButton onClick={() => startEdit(video)}>Edit</SmallButton>
                    <SmallButton variant="danger" onClick={() => setDeleteTarget(video.id)}>Delete</SmallButton>
                  </div>

                </div>

              ))}

            </div>

          )}

        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this video?"
        description="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

    </div>
  )
}

export default TrainingVideosManager
