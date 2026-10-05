import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchLandingContent, saveFooterContent } from '../../api/landingPage'
import { defaultContent } from '../../content/defaultContent'
import { deepMerge } from '../../utils/objectPath'
import { resolveText, setTextForLanguage } from '../../utils/multilingual'
import { contactItems, socialLinks, mapFromLocation, validateFooter } from '../../utils/footerContent'
import { useI18n } from '../../i18n/I18nContext'
import FooterPreview from '../../components/editor/FooterPreview'
import './FooterEditor.css'

function Field({ label, value, onChange, ...props }) {
  return <label className="footer-field"><span>{label}</span><input value={value ?? ''} onChange={e => onChange(e.target.value)} {...props} /></label>
}
function Toggle({ label, checked, onChange }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />{label}</label>
}
function OrderControls({ index, items, onChange, name }) {
  function move(offset) {
    const next = [...items]
    ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
    onChange(next)
  }
  return <div className="flex flex-wrap gap-2 mt-3">
    <button type="button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => move(-1)}>↑ Move up</button>
    <button type="button" aria-label={`Move ${name} down`} disabled={index === items.length - 1} onClick={() => move(1)}>↓ Move down</button>
    <button type="button" onClick={() => { if (window.confirm(`Remove ${name}? You can discard changes before saving.`)) onChange(items.filter((_, i) => i !== index)) }}>Remove</button>
  </div>
}

export default function FooterEditor() {
  const { language, setLanguage, t } = useI18n()
  const [content, setContent] = useState(null)
  const [footer, setFooter] = useState(null)
  const [saved, setSaved] = useState(null)
  const [previous, setPrevious] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const dirty = footer !== null && JSON.stringify(footer) !== JSON.stringify(saved)

  useEffect(() => {
    let active = true
    fetchLandingContent('published').then(data => {
      if (!active) return
      const merged = deepMerge(defaultContent, data.content)
      setContent(merged)
      setFooter(merged.sections.footer)
      setSaved(merged.sections.footer)
      setPrevious(data.content.sections?.footer ?? {})
      setError('')
    }).catch(() => { if (active) setError('Could not load the footer. Please retry before editing.') })
    return () => { active = false }
  }, [attempt])

  useEffect(() => {
    if (!dirty) return
    const guard = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  function update(patch) { setFooter(current => ({ ...current, ...patch })); setNotice(''); setError('') }
  function updateMap(patch) {
    const location = { ...footer, ...patch }
    try {
      const mapEmbedUrl = mapFromLocation(location.mapAddress ?? resolveText(location.address?.text, language), location.mapUrl ?? location.address?.mapsLink ?? '')
      update({ ...patch, mapEmbedUrl })
    } catch (err) { update(patch); setError(err.message) }
  }
  async function save(event) {
    event.preventDefault()
    let next = footer
    try {
      if (footer.mapAddress !== saved.mapAddress || footer.mapUrl !== saved.mapUrl) {
        next = { ...footer, mapEmbedUrl: mapFromLocation(footer.mapAddress ?? resolveText(footer.address?.text, language), footer.mapUrl ?? footer.address?.mapsLink ?? '') }
      }
      const invalid = validateFooter(next)
      if (invalid) { setError(invalid); return }
      setSaving(true); setError(''); setNotice('')
      await saveFooterContent(next, previous)
      setFooter(next); setSaved(next); setPrevious(next)
      setNotice('Footer saved. Your changes are now live on the website.')
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  if (!footer) return <main className="footer-editor p-8 min-h-screen"><h1 className="text-3xl mb-6">Footer</h1>{error ? <><p role="alert">{error}</p><button onClick={() => setAttempt(attempt + 1)}>Retry</button></> : <p role="status">Loading footer…</p>}<p className="mt-5"><Link to="/admin">Back to Admin</Link></p></main>
  const contacts = contactItems(footer)
  const socials = socialLinks(footer)
  const text = value => resolveText(value, language)
  const localized = (old, value) => setTextForLanguage(old, language, value)
  const patchContact = (index, patch) => update({ contactItems: contacts.map((item, i) => i === index ? { ...item, ...patch } : item) })
  const patchSocial = (index, patch) => update({ socialLinks: socials.map((item, i) => i === index ? { ...item, ...patch } : item) })

  return <main className="footer-editor min-h-screen">
    <header className="p-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
      <div><Link to="/admin" onClick={e => { if (saving || (dirty && !window.confirm('Leave and discard your unsaved footer changes?'))) e.preventDefault() }}>← Admin</Link><h1 className="text-3xl mt-3">Footer</h1><p className="text-gray-400 mt-1">Manage the details that help visitors find and contact you.</p></div>
      <label className="footer-field">Editing language<select value={language} onChange={e => setLanguage(e.target.value)}><option value="en">English</option><option value="es">Español</option><option value="ca">Català</option></select></label>
    </header>
    <form onSubmit={save}>
      <div className="footer-workspace">
        <fieldset disabled={saving} className="min-w-0 space-y-5">
          <section className="footer-card"><h2>Visibility</h2><Toggle label="Show footer on the website" checked={footer.visible !== false} onChange={visible => update({ visible })} /></section>
          <section className="footer-card"><h2>Google Maps</h2><p>Use an address or paste a Google Maps link. For a shortened share link, also enter the full address.</p>
            <Field label="Location / Address" value={footer.mapAddress ?? text(footer.address?.text)} onChange={mapAddress => updateMap({ mapAddress, mapUrl: '' })} />
            <Field label="Google Maps URL" value={footer.mapUrl ?? footer.address?.mapsLink ?? ''} placeholder="https://www.google.com/maps/…" onChange={mapUrl => updateMap({ mapUrl })} />
            <Toggle label="Show map" checked={footer.mapVisible !== false} onChange={mapVisible => update({ mapVisible })} />
            <button type="button" className="mt-3" onClick={() => updateMap({})}>Update Map</button>
            {footer.mapEmbedUrl && <iframe className="w-full h-44 rounded-lg mt-4 border-0" title="Location preview" src={footer.mapEmbedUrl} loading="lazy" />}
            {footer.streetView360EmbedUrl && <div className="mt-4"><Toggle label="Show existing 360° view" checked={footer.streetViewVisible !== false} onChange={streetViewVisible => update({ streetViewVisible })} /></div>}
          </section>
          <section className="footer-card"><h2>Get in Touch</h2><p>Edit the contact details below. Labels and addresses can be translated using the language selector.</p>
            <Field label="Heading" value={text(footer.contactHeading) || t('footer_get_in_touch')} onChange={value => update({ contactHeading: localized(footer.contactHeading ?? { en: 'Get In Touch', es: 'Contáctanos', ca: 'Contacta amb nosaltres' }, value) })} />
            {contacts.map((item, index) => <div className="footer-item" key={item.id}>
              <label className="footer-field">Type<select value={item.type} onChange={e => patchContact(index, { type: e.target.value, url: '' })}>{['email', 'phone', 'address', 'link', 'text'].map(type => <option key={type} value={type}>{type}</option>)}</select></label>
              <Field label="Label (optional)" value={text(item.label)} onChange={value => patchContact(index, { label: localized(item.label, value) })} />
              <Field label={item.type === 'email' ? 'Email' : item.type === 'phone' ? 'Phone' : item.type === 'address' ? 'Address' : 'Value'} value={text(item.value)} onChange={value => patchContact(index, { value: ['text', 'address'].includes(item.type) ? localized(item.value, value) : value })} />
              {['link', 'address'].includes(item.type) && <Field label="Link destination (optional)" value={item.url} onChange={url => patchContact(index, { url })} />}
              <label className="footer-field">Icon<select value={item.icon || ''} onChange={e => patchContact(index, { icon: e.target.value })}><option value="">None</option><option value="pin">Location</option><option value="mail">Email</option><option value="whatsapp">WhatsApp</option><option value="arrow">Arrow</option></select></label>
              <Toggle label="Visible" checked={item.visible !== false} onChange={visible => patchContact(index, { visible })} />
              <OrderControls index={index} items={contacts} name={text(item.label) || text(item.value) || 'contact item'} onChange={contactItems => update({ contactItems })} />
            </div>)}
            <button type="button" onClick={() => update({ contactItems: [...contacts, { id: crypto.randomUUID(), type: 'email', label: '', value: '', visible: true, icon: 'mail' }] })}>+ Add contact item</button>
          </section>
          <section className="footer-card"><h2>Social Links</h2><p>Choose which social profiles visitors can find.</p>
            {socials.map((item, index) => <div key={item.id} className="footer-item">
              <Field label="Platform" value={item.label} onChange={label => patchSocial(index, { label })} />
              <Field label="URL" value={item.url} onChange={url => patchSocial(index, { url })} />
              <Toggle label="Visible" checked={item.visible !== false} onChange={visible => patchSocial(index, { visible })} />
              <OrderControls index={index} items={socials} name={item.label || 'social link'} onChange={socialLinks => update({ socialLinks })} />
            </div>)}
            <button type="button" onClick={() => update({ socialLinks: [...socials, { id: crypto.randomUUID(), label: '', url: '', visible: true }] })}>+ Add social link</button>
          </section>
        </fieldset>
        <FooterPreview content={{ ...content, sections: { ...content.sections, footer } }} />
      </div>
      <div className="footer-savebar">
        <div aria-live="polite">{error ? <p role="alert" className="text-red-300">{error}</p> : <p>{notice || (dirty ? 'You have unsaved changes.' : 'All changes saved.')}</p>}<p className="text-xs text-gray-400 mt-1">Saving updates the public footer immediately.</p></div>
        <div className="flex gap-2 shrink-0"><button type="button" disabled={!dirty || saving} onClick={() => { if (window.confirm('Discard all unsaved footer changes?')) { setFooter(saved); setError(''); setNotice('Changes discarded.') } }}>Discard Changes</button><button className="footer-save" type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save Changes'}</button></div>
      </div>
    </form>
  </main>
}
