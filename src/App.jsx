import AppRoutes from './routes/AppRoutes'
import { I18nProvider } from './i18n/I18nContext'
import LanguageSync from './components/LanguageSync'
import RolesProvider from './roles/RolesProvider'
import EmailVerificationGate from './auth/EmailVerificationGate'
import AppErrorBoundary from './components/AppErrorBoundary'


function App() {
  return (
    <I18nProvider>
      <AppErrorBoundary>
        <LanguageSync />
        <EmailVerificationGate />
        <RolesProvider>
          <AppRoutes />
        </RolesProvider>
      </AppErrorBoundary>
    </I18nProvider>
  )
}

export default App