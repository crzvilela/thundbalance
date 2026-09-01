import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useLandingContent } from '../../content/LandingContentContext'
import ConfirmDialog from './ConfirmDialog'

const DEVICES = [
  { key: 'desktop', icon: '🖥️', label: 'Desktop' },
  { key: 'tablet', icon: '📱', label: 'Tablet' },
  { key: 'mobile', icon: '📲', label: 'Mobile' }
]

export default function EditorTopbar() {
  const navigate = useNavigate()
  const {
    device, setDevice,
    undo, redo, canUndo, canRedo,
    save, publish, reset,
    saving, publishing, dirty, lastSavedAt
  } = useLandingContent()

  const [resetModalOpen, setResetModalOpen] = useState(false)

  const handlePublish = async () => {
    await publish()
    window.open('/', '_blank')
  }

  const handlePreview = () => {
    window.open('/?preview=true', '_blank')
  }

  const handleConfirmReset = async () => {
    await reset()
    setResetModalOpen(false)
  }

  return (
    <header className="h-16 shrink-0 bg-[#0b0b0b] border-b border-white/10 flex items-center justify-between px-5">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/admin')}
          className="text-gray-400 hover:text-white text-sm"
        >
          ← Admin
        </button>
        <div className="h-6 w-px bg-white/10" />
        <h1 className="text-sm font-semibold uppercase tracking-wider text-white">Landing Page Editor</h1>
      </div>

      <div className="flex items-center gap-1 bg-[#151515] rounded-lg p-1">
        {DEVICES.map((d) => (
          <button
            key={d.key}
            onClick={() => setDevice(d.key)}
            title={d.label}
            className={`px-3 py-1.5 rounded-md text-sm transition ${
              device === d.key ? 'bg-emerald-500 text-black' : 'text-gray-400 hover:text-white'
            }`}
          >
            {d.icon} <span className="hidden lg:inline">{d.label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={undo}
          disabled={!canUndo}
          title="Undo"
          className={`w-9 h-9 rounded-lg border border-white/10 flex items-center justify-center ${
            canUndo ? 'hover:bg-white/10 text-white' : 'text-gray-600 cursor-not-allowed'
          }`}
        >
          ↶
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          title="Redo"
          className={`w-9 h-9 rounded-lg border border-white/10 flex items-center justify-center ${
            canRedo ? 'hover:bg-white/10 text-white' : 'text-gray-600 cursor-not-allowed'
          }`}
        >
          ↷
        </button>

        <div className="h-6 w-px bg-white/10" />

        <button
          onClick={() => setResetModalOpen(true)}
          className="text-xs uppercase tracking-wider px-3 py-2 rounded-lg border border-white/10 text-gray-400 hover:text-white transition"
        >
          Restore Default Base
        </button>

        <span className="text-[11px] text-gray-500 w-28 text-right">
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : lastSavedAt ? `Saved` : ''}
        </span>

        <button
          onClick={handlePreview}
          className="text-xs uppercase tracking-wider px-4 py-2 rounded-lg border border-white/15 text-white hover:bg-white/10 transition"
        >
          Preview
        </button>

        <button
          onClick={save}
          disabled={saving}
          className="text-xs uppercase tracking-wider px-4 py-2 rounded-lg border border-white/15 text-white hover:bg-white/10 transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>

        <button
          onClick={handlePublish}
          disabled={publishing}
          className="text-xs uppercase tracking-wider px-5 py-2 rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 transition disabled:opacity-50"
        >
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
      </div>

      <ConfirmDialog
        open={resetModalOpen}
        title="Restore Default Base?"
        description="This will discard your current draft and replace it with the original default version of the landing page. This cannot be undone with the undo button. Your published (live) site will not change until you click Publish again."
        confirmLabel="Restore"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmReset}
        onCancel={() => setResetModalOpen(false)}
      />
    </header>
  )
}
