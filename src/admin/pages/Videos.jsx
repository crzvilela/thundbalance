import { useCallback, useEffect, useRef, useState } from 'react'
import TrainingVideoPlayer from '../../components/TrainingVideoPlayer'
import {
  createTrainingVideo, deleteTrainingVideo, fetchTrainingVideos,
  reorderTrainingVideos, updateTrainingVideo
} from '../../api/trainingVideos'
import { uploadLandingVideo } from '../../api/landingPage'
import { resolveText } from '../../utils/multilingual'
import { useAdminText } from '../useAdminText'
import { useToast } from '../toastContext'
import { Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Icon, PageHeader, Skeleton, TextArea, TextInput } from '../ui'

// Videos are upload-only: video_source is always 'upload' for anything saved
// here. Older videos with another source still play on the public page.
const EMPTY_FORM = { title: '', description: '', video_source: 'upload', video_url: '' }

export default function Videos() {
  const { t, language } = useAdminText()
  const toast = useToast()
  const fileInput = useRef(null)

  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null) // null | 'new' | video id
  const [form, setForm] = useState(EMPTY_FORM)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion(value => value + 1), [])

  useEffect(() => {
    let cancelled = false
    fetchTrainingVideos()
      .then(data => { if (!cancelled) { setVideos(data); setError(''); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err.message || 'Error'); setLoading(false) } })
    return () => { cancelled = true }
  }, [version])

  const openNew = () => { setForm(EMPTY_FORM); setEditingId('new') }
  const openEdit = (video) => {
    setForm({
      title: resolveText(video.title, language),
      description: resolveText(video.description, language),
      video_source: 'upload',
      video_url: video.video_source === 'upload' ? video.video_url : ''
    })
    setEditingId(video.id)
  }
  const close = () => { setEditingId(null); setForm(EMPTY_FORM) }

  const upload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadLandingVideo(file)
      setForm(current => ({ ...current, video_url: url }))
    } catch {
      toast.push(t('vd_upload_error'), 'error')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const save = async () => {
    if (!form.title.trim() || !form.video_url.trim()) { toast.push(t('vd_required'), 'error'); return }
    setSaving(true)
    try {
      if (editingId === 'new') await createTrainingVideo(form)
      else await updateTrainingVideo(editingId, form)
      toast.push(t('vd_saved'))
      close()
      reload()
    } catch (err) {
      toast.push(err.message || 'Error', 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    try {
      await deleteTrainingVideo(deleteTarget)
      toast.push(t('vd_deleted'))
      reload()
    } catch (err) {
      toast.push(err.message || 'Error', 'error')
    } finally {
      setSaving(false)
      setDeleteTarget(null)
    }
  }

  const move = async (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= videos.length) return
    const next = [...videos]
    ;[next[index], next[target]] = [next[target], next[index]]
    setVideos(next)
    try {
      await reorderTrainingVideos(next.map(video => video.id))
    } catch {
      reload() // out of sync with the server: reload the real order
    }
  }

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('videos_title')} subtitle={t('vd_sub')}
        actions={<Button variant="primary" onClick={openNew}><Icon name="video" className="h-4 w-4" />{t('vd_add')}</Button>}
      />

      {error ? (
        <Card><ErrorState message={`${t('load_error')} (${error})`} retryLabel={t('retry')} onRetry={() => { setLoading(true); reload() }} /></Card>
      ) : loading ? (
        <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      ) : videos.length === 0 ? (
        <Card><EmptyState icon="video" title={t('vd_empty')} action={<Button variant="primary" onClick={openNew}>{t('vd_add')}</Button>} /></Card>
      ) : (
        <ul className="space-y-3">
          {videos.map((video, index) => (
            <li key={video.id}>
              <Card className="flex flex-col gap-4 p-4 transition hover:border-white/20 sm:flex-row sm:items-center">
                <div className="w-full shrink-0 overflow-hidden rounded-xl sm:w-40">
                  <TrainingVideoPlayer source={video.video_source} url={video.video_url} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{resolveText(video.title, language)}</p>
                  {resolveText(video.description, language) && (
                    <p className="mt-1 line-clamp-2 text-sm text-gray-400 [overflow-wrap:anywhere]">{resolveText(video.description, language)}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('vd_up')} title={t('vd_up')} className="rounded-lg p-2 text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30"><Icon name="arrow" className="h-4 w-4 -rotate-90" /></button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === videos.length - 1} aria-label={t('vd_down')} title={t('vd_down')} className="rounded-lg p-2 text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30"><Icon name="arrow" className="h-4 w-4 rotate-90" /></button>
                  <Button variant="secondary" onClick={() => openEdit(video)}>{t('vd_edit')}</Button>
                  <Button variant="danger" onClick={() => setDeleteTarget(video.id)}>{t('vd_remove')}</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={!!editingId} onClose={close} busy={saving || uploading}
        title={editingId === 'new' ? t('vd_new_title') : t('vd_edit_title')}
        footer={<>
          <Button variant="secondary" className="flex-1" onClick={close} disabled={saving}>{t('cancel')}</Button>
          <Button variant="primary" className="flex-[2]" onClick={save} loading={saving} disabled={uploading}>{saving ? t('vd_saving') : t('vd_save')}</Button>
        </>}
      >
        <Field label={t('vd_title')}><TextInput value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} disabled={saving} /></Field>
        <Field label={t('vd_desc')}><TextArea rows={4} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} disabled={saving} /></Field>
        <input ref={fileInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={upload} />
        <Button variant="secondary" onClick={() => fileInput.current?.click()} loading={uploading} disabled={saving}>
          {uploading ? t('vd_uploading') : form.video_url ? t('vd_replace') : t('vd_upload')}
        </Button>
        {form.video_url && (
          <div className="mt-5">
            <p className="mb-2 text-xs text-emerald-400">{t('vd_uploaded')}</p>
            <TrainingVideoPlayer source="upload" url={form.video_url} />
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!deleteTarget} busy={saving}
        title={t('vd_delete_title')} text={t('vd_delete_text')}
        confirmLabel={t('vd_remove')} cancelLabel={t('cancel')}
        onConfirm={remove} onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
