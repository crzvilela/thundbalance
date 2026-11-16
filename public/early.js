// Starts the two public requests the landing page cannot draw without (its content and the prices) while the JavaScript of the page is
// still downloading. The address of the API is in <meta name="tb-api">, written by vite.config.js at build time.
// An external file (not inline) because the Content-Security-Policy forbids inline scripts.
(function () {
  try {
    var meta = document.querySelector('meta[name="tb-api"]')
    if (!meta || !meta.content || window.location.pathname !== '/' || window.location.search.indexOf('preview=true') !== -1) return
    ;['/landing-page/content?version=published', '/pricing'].forEach(function (path) {
      var link = document.createElement('link')
      link.rel = 'preload'
      link.as = 'fetch'
      link.crossOrigin = 'anonymous'
      link.href = meta.content + path
      document.head.appendChild(link)
    })
  } catch { /* only a head start: the page asks for the same data itself */ }
})()
