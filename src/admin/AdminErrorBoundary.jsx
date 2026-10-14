import { Component } from 'react'

// A render error in an admin page used to leave a black screen until F5. This
// shows the error text (so it can be reported) and a reload button instead.
export default class AdminErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Admin page crashed:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="m-6 rounded-xl border border-red-400/30 bg-red-400/5 p-6 text-gray-200">
        <p className="mb-2 text-lg font-semibold">Something went wrong on this page / Algo ha fallado en esta página</p>
        <p className="mb-4 break-words text-sm text-gray-400">{String(this.state.error?.message || this.state.error)}</p>
        <button type="button" className="rounded-lg border border-white/20 px-4 py-2" onClick={() => window.location.reload()}>
          Reload / Recargar
        </button>
      </div>
    )
  }
}
