/* Sets <html lang> before the page is drawn: the language the visitor chose (saved by the site), else the one in the link (?lang=xx),
   else the page's own "en". It is a file (not inline code) because the Content-Security-Policy does not allow inline scripts.
   The site keeps <html lang> up to date when the language is changed (src/i18n/I18nContext.jsx). Same rules as that file. */
(function () {
  try {
    var supported = { en: true, es: true, ca: true }
    var lang = null
    try {
      var stored = window.localStorage.getItem('tb_language')
      if (supported[stored] === true) lang = stored
    } catch { /* storage unavailable: it is not a choice */ }
    if (!lang) {
      var fromLink = new URLSearchParams(window.location.search).get('lang')
      if (supported[fromLink] === true) lang = fromLink
    }
    if (lang) document.documentElement.lang = lang
  } catch { /* never stop the page for this */ }
})()
