import { useLandingContent } from '../../content/LandingContentContext'
import { resolveText, setTextForLanguage } from '../../utils/multilingual'
import { useI18n } from '../../i18n/I18nContext'
import { ColorField, SelectField, TextField, ToggleField } from './fields'

const ICON_OPTIONS = [
  ['location', 'Location'], ['email', 'Email'], ['gmail', 'Gmail'], ['phone', 'Phone'], ['instagram', 'Instagram'],
  ['facebook', 'Facebook'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['linkedin', 'LinkedIn'],
  ['whatsapp', 'WhatsApp'], ['x', 'X'], ['pinterest', 'Pinterest']
]
const DEFAULT_ICONS = [
  { id: 'location', icon: 'location', label: 'Google Maps', url: 'https://www.google.com/maps/place//data=!4m2!3m1!1s0x12a4a385af63a49b:0x841dd304c428a382?sa=X&ved=1t:8290&ictx=111', newTab: true, visible: true },
  { id: 'email', icon: 'email', label: 'Email', url: 'mailto:info@thundbalance.com', newTab: true, visible: true },
  { id: 'whatsapp', icon: 'whatsapp', label: 'WhatsApp', url: 'https://wa.me/+34617213360', newTab: true, visible: true },
  { id: 'instagram', icon: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/thundbalance/', newTab: true, visible: true },
  { id: 'youtube', icon: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@thundbalance3668', newTab: true, visible: true }
]
const iconLabel = icon => ICON_OPTIONS.find(([key]) => key === icon)?.[1] || icon

function VisualIconPicker({ value, onChange }) {
  return <div className="mb-4">
    <p className="mb-2 text-xs text-gray-400">Icon</p>
    <div className="grid grid-cols-4 gap-2">
      {ICON_OPTIONS.map(([icon, label]) => <button key={icon} type="button" aria-label={label} title={label} onClick={() => onChange(icon)} className={`rounded-lg border px-2 py-2 text-[10px] transition ${value === icon ? 'border-emerald-400 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/30'}`}><span className="block text-base">{({ location: '⌖', email: '✉', phone: '☎', instagram: '◎', facebook: 'f', tiktok: '♪', youtube: '▶', linkedin: 'in', whatsapp: '◉', x: '𝕏', pinterest: '℘' })[icon]}</span>{label}</button>)}
    </div>
  </div>
}

export default function FooterElementPanel({ elementKey, onClose }) {
  const { content, updateField, select } = useLandingContent()
  const { language } = useI18n()
  const section = content.sections.footer || {}
  const icons = Array.isArray(section.footerIcons) ? section.footerIcons : DEFAULT_ICONS.map(icon => {
    if (icon.id === 'location') return { ...icon, url: resolveText(section.address?.mapsLink, language) || icon.url }
    if (icon.id === 'email') return { ...icon, url: resolveText(section.contactEmail, language) ? `mailto:${resolveText(section.contactEmail, language)}` : icon.url }
    if (icon.id === 'whatsapp') return { ...icon, url: resolveText(section.whatsappLink, language) || icon.url }
    if (icon.id === 'instagram') return { ...icon, url: resolveText(section.instagramUrl, language) || icon.url }
    return icon
  })
  const settings = section.settings || {}
  const selectedIndex = typeof elementKey === 'string' && elementKey.startsWith('icon:') ? icons.findIndex(icon => (icon.id || icon.icon) === elementKey.slice(5)) : -1
  const selectedIcon = selectedIndex >= 0 ? icons[selectedIndex] : null
  const set = (field, value) => updateField(`sections.footer.${field}`, value)
  const setSettings = (field, value) => updateField(`sections.footer.settings.${field}`, value)
  const setIcons = value => set('footerIcons', value)
  const setIcon = (field, value) => setIcons(icons.map((icon, index) => index === selectedIndex ? { ...icon, [field]: value } : icon))
  const setCopyright = value => set('text', setTextForLanguage(section.text, language, value))
  const setText = (field, value) => set(field, setTextForLanguage(section[field], language, value))
  const addIcon = icon => {
    const id = `${icon}-${Date.now().toString(36)}`
    const item = { id, icon, label: iconLabel(icon), url: icon === 'email' ? 'mailto:' : icon === 'phone' ? 'tel:' : 'https://', newTab: true, visible: true }
    setIcons([...icons, item])
    select({ type: 'footerElement', path: `icon:${id}` })
  }
  const moveIcon = (index, direction) => {
    const next = [...icons]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setIcons(next)
  }

  return <div>
    <div className="mb-5 flex items-center justify-between"><h3 className="text-lg font-semibold">Footer</h3><button onClick={onClose} className="text-xs text-gray-400 hover:text-white">Close</button></div>
    {selectedIcon ? <>
      <button onClick={() => select({ type: 'section', path: 'footer', label: 'Footer' })} className="mb-5 text-xs text-emerald-400">← Footer settings</button>
      <p className="mb-4 text-xs uppercase tracking-wider text-emerald-400">{resolveText(selectedIcon.label, language) || 'Footer icon'}</p>
      <VisualIconPicker value={selectedIcon.icon} onChange={value => setIcon('icon', value)} />
      <TextField label="Label" value={resolveText(selectedIcon.label, language)} onChange={value => setIcon('label', setTextForLanguage(selectedIcon.label, language, value))} />
      <TextField label="URL" value={resolveText(selectedIcon.url, language)} onChange={value => setIcon('url', value)} />
      <ToggleField label="Open in new tab" value={selectedIcon.newTab !== false} onChange={value => setIcon('newTab', value)} />
      <ToggleField label="Show icon" value={selectedIcon.visible !== false} onChange={value => setIcon('visible', value)} />
      <button className="mb-4 rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-300" onClick={() => { setIcons(icons.filter((_, index) => index !== selectedIndex)); select({ type: 'section', path: 'footer', label: 'Footer' }) }}>Remove icon</button>
      <div className="flex gap-2"><button disabled={selectedIndex === 0} onClick={() => moveIcon(selectedIndex, -1)} className="rounded border border-white/10 px-3 py-2 text-xs disabled:opacity-30">Move left</button><button disabled={selectedIndex === icons.length - 1} onClick={() => moveIcon(selectedIndex, 1)} className="rounded border border-white/10 px-3 py-2 text-xs disabled:opacity-30">Move right</button></div>
    </> : <>
      <TextField label="Footer title" value={resolveText(section.brand, language)} onChange={value => setText('brand', value)} />
      <TextField label="Google Maps URL" value={resolveText(icons.find(icon => icon.icon === 'location')?.url, language)} onChange={value => {
        const index = icons.findIndex(icon => icon.icon === 'location')
        if (index >= 0) setIcons(icons.map((icon, i) => i === index ? { ...icon, url: value } : icon))
        else setIcons([...icons, { id: `location-${Date.now()}`, icon: 'location', label: 'Google Maps', url: value, newTab: true, visible: true }])
      }} />
      <TextField label="Email" value={resolveText(icons.find(icon => icon.icon === 'email')?.url, language).replace(/^mailto:/, '')} onChange={value => {
        const index = icons.findIndex(icon => icon.icon === 'email')
        if (index >= 0) setIcons(icons.map((icon, i) => i === index ? { ...icon, url: value.startsWith('mailto:') ? value : `mailto:${value}` } : icon))
        else setIcons([...icons, { id: `email-${Date.now()}`, icon: 'email', label: 'Email', url: `mailto:${value}`, newTab: true, visible: true }])
      }} />
      <TextField label="WhatsApp URL" value={resolveText(icons.find(icon => icon.icon === 'whatsapp')?.url, language)} onChange={value => {
        const index = icons.findIndex(icon => icon.icon === 'whatsapp')
        if (index >= 0) setIcons(icons.map((icon, i) => i === index ? { ...icon, url: value } : icon))
        else setIcons([...icons, { id: `whatsapp-${Date.now()}`, icon: 'whatsapp', label: 'WhatsApp', url: value, newTab: true, visible: true }])
      }} />
      <TextField label="Instagram URL" value={resolveText(icons.find(icon => icon.icon === 'instagram')?.url, language)} onChange={value => {
        const index = icons.findIndex(icon => icon.icon === 'instagram')
        if (index >= 0) setIcons(icons.map((icon, i) => i === index ? { ...icon, url: value } : icon))
        else setIcons([...icons, { id: `instagram-${Date.now()}`, icon: 'instagram', label: 'Instagram', url: value, newTab: true, visible: true }])
      }} />
      <TextField label="Privacy Policy URL" value={resolveText(section.privacyPolicyUrl, language)} onChange={value => set('privacyPolicyUrl', value)} />
      <TextField label="Terms URL" value={resolveText(section.termsUrl, language)} onChange={value => set('termsUrl', value)} />
      <TextField label="Copyright text" value={resolveText(section.text, language)} onChange={setCopyright} />
      <p className="mb-3 mt-6 text-xs uppercase tracking-wider text-emerald-400">Icon links</p>
      <div className="mb-4 grid gap-2">{icons.map((icon, index) => { const label = resolveText(icon.label, language); return <div key={icon.id || index} className="flex items-center gap-2"><button onClick={() => select({ type: 'footerElement', path: `icon:${icon.id || icon.icon}` })} className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-left text-sm hover:border-emerald-400">{iconLabel(icon.icon)} · {label}</button><button aria-label={`Move ${label} up`} onClick={() => moveIcon(index, -1)} disabled={index === 0} className="px-1 text-gray-400 disabled:opacity-30">↑</button><button aria-label={`Move ${label} down`} onClick={() => moveIcon(index, 1)} disabled={index === icons.length - 1} className="px-1 text-gray-400 disabled:opacity-30">↓</button></div> })}</div>
      <VisualIconPicker value="" onChange={addIcon} />
      <TextField label="Icon size (px)" value={settings.iconSize ?? 18} onChange={value => setSettings('iconSize', Math.max(12, Math.min(28, Number(value) || 18)))} />
      <TextField label="Icon spacing (px)" value={settings.iconSpacing ?? 18} onChange={value => setSettings('iconSpacing', Math.max(4, Math.min(48, Number(value) || 18)))} />
      <SelectField label="Alignment" value={settings.alignment || 'center'} onChange={value => setSettings('alignment', value)} options={['left', 'center', 'right'].map(value => ({ value, label: value }))} />
      <ColorField label="Background color" value={settings.backgroundColor || '#050505'} onChange={value => setSettings('backgroundColor', value)} />
      <ColorField label="Text color" value={settings.textColor || '#ffffff'} onChange={value => setSettings('textColor', value)} />
      <SelectField label="Typography" value={settings.fontFamily || ''} onChange={value => setSettings('fontFamily', value)} options={[{ value: '', label: 'Site default' }, ...['Inter', 'Bebas Neue', 'Roboto', 'Aldrich'].map(value => ({ value, label: value }))]} />
    </>}
    <p className="mt-5 text-xs text-gray-500">Save or publish from the editor toolbar to keep your changes.</p>
  </div>
}
