import AppRoutes from './routes/AppRoutes'
import { I18nProvider } from './i18n/I18nContext'


function App() {
  return (
    <I18nProvider>
      <AppRoutes />
    </I18nProvider>
  )
}

export default App