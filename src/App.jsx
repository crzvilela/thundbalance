import AppRoutes from './routes/AppRoutes'
import { I18nProvider } from './i18n/I18nContext'
import LanguageSync from './components/LanguageSync'


function App() {
  return (
    <I18nProvider>
      <LanguageSync />
      <AppRoutes />
    </I18nProvider>
  )
}

export default App