import { Component } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { isStaleBuildError, textsFor } from '../i18n/errorPages'
import logo from '../assets/images/thundbalance-logo.svg?inline'

// The last safety net of the whole site: a render error anywhere shows a simple page (never the technical error) with a button to reload,
// instead of a blank screen. When the error is the one a new version causes (a file of the old version that no longer exists), the page
// reloads itself ONCE to pick up the new version.
const RELOADED_KEY = 'tb_reloaded_after_error'

function ErrorPage() {
  const { language } = useI18n()
  const text = textsFor(language)
  return (
    <main role="alert" className="flex min-h-[100dvh] flex-col items-center justify-center bg-black px-6 py-12 text-center text-white">
      <img src={logo} alt="ThundBalance" className="mb-10 h-10 w-auto" />
      <h1 className="text-2xl font-semibold sm:text-3xl">{text.errorTitle}</h1>
      <p className="mt-3 max-w-md text-base leading-7 text-gray-400">{text.errorText}</p>
      <button
        type="button" onClick={() => window.location.reload()}
        className="mt-9 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-400 px-6 font-semibold text-black transition hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {text.reload}
      </button>
    </main>
  )
}

export default class AppErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    // only the kind of error goes to the console: no message, no data
    console.error('The page crashed:', error?.name || 'Error')
    if (isStaleBuildError(error)) {
      try {
        if (window.sessionStorage.getItem(RELOADED_KEY) !== '1') {
          window.sessionStorage.setItem(RELOADED_KEY, '1')
          window.location.reload()
        }
      } catch {
        // storage unavailable: the page with the reload button is shown
      }
    }
  }

  render() {
    return this.state.failed ? <ErrorPage /> : this.props.children
  }
}
