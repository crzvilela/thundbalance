import { useEffect } from 'react'

// Keeps <html lang> equal to the language the screen is really written in (screen readers pick the voice from it). The admin panel has
// its own language (English / Spanish), so while it is open it sets that one and gives the site's back when it closes.
export function useDocumentLanguage(language) {
  useEffect(() => {
    const previous = document.documentElement.lang
    document.documentElement.lang = language
    return () => { document.documentElement.lang = previous }
  }, [language])
}
