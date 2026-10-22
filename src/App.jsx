import AppRoutes from './routes/AppRoutes'
import { I18nProvider } from './i18n/I18nContext'
import LanguageSync from './components/LanguageSync'
import RolesProvider from './roles/RolesProvider'


function App() {
  return (
    <I18nProvider>
      <LanguageSync />
      <RolesProvider>
        <AppRoutes />
      </RolesProvider>
    </I18nProvider>
  )
}

export default App