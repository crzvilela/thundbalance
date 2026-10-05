import { useState } from 'react'
import { createPortal } from 'react-dom'
import Footer from '../Footer'
import { LandingContentPreviewProvider } from '../../content/LandingContentContext'

export default function FooterPreview({ content }) {
  const [target, setTarget] = useState(null)
  const [mobile, setMobile] = useState(false)
  return <section className="footer-preview" aria-label="Live footer preview">
    <div className="flex items-center justify-between gap-3 p-4">
      <h2 className="font-semibold">Live preview</h2>
      <div className="flex gap-2">
        <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}>Desktop</button>
        <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)}>Mobile</button>
      </div>
    </div>
    {!content.sections.footer.visible && <p className="p-4 text-amber-300">The footer is hidden from visitors.</p>}
    <div className="overflow-auto">
      <iframe title="Live footer preview" className="footer-preview-frame" style={{ width: mobile ? 375 : 1024 }}
        srcDoc="<!doctype html><html><head></head><body style='margin:0;background:black'><div id='footer-preview-root'></div></body></html>"
        onLoad={event => {
          const doc = event.currentTarget.contentDocument
          if (!doc.head.querySelector('[data-preview-style]')) {
            document.querySelectorAll('style, link[rel="stylesheet"]').forEach(style => {
              const clone = style.cloneNode(true)
              clone.setAttribute('data-preview-style', '')
              doc.head.appendChild(clone)
            })
            doc.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault() })
          }
          setTarget(doc.getElementById('footer-preview-root'))
        }} />
      {target && createPortal(<LandingContentPreviewProvider content={content}><Footer /></LandingContentPreviewProvider>, target)}
    </div>
    <p className="p-4 text-xs text-gray-400">Changes appear here before saving. Scroll to explore the full footer.</p>
  </section>
}
