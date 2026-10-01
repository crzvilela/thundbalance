import { useLandingContent } from '../../content/LandingContentContext'
import { useI18n } from '../../i18n/I18nContext'
import { resolveText, setTextForLanguage } from '../../utils/multilingual'
import { FOOTER_ELEMENTS, FOOTER_ICONS, footerElement } from '../../utils/footerElements'
import { TextField, SelectField } from './fields'

function NumericField({ label, value, onChange, min, max = 2000 }) {
  return <label className="mb-4 block text-xs text-gray-400">{label} (px)<input aria-label={label} type="number" min={min} max={max} value={value ?? ''} placeholder="Auto" onChange={event => {
    const raw = event.target.value
    if (!raw) { onChange(''); return }
    const number = Number(raw)
    if (Number.isFinite(number)) onChange(Math.min(max, Math.max(min ?? -2000, number)))
  }} className="mt-2 w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" /></label>
}

export default function FooterElementPanel({ elementKey, onClose }) {
  const { content, select, device, updateField } = useLandingContent()
  const { language } = useI18n()
  const section = content.sections.footer || {}
  const contactId = (content.sectionOrder || []).find(id => content.sections[id]?.type === 'contact' && content.sections[id]?.visible !== false) || 'contact'
  const selected = FOOTER_ELEMENTS.find(([key]) => key === elementKey)
  const element = selected ? footerElement(section, elementKey, `/#${contactId}`) : null
  const path = `sections.footer.elements.${elementKey}`
  const set = (field, value) => updateField(`${path}.${field}`, value)
  const layout = element ? { ...element, ...element.layout?.[device] } : {}
  const setLayout = (field, value) => set(`layout.${device}.${field}`, value)
  const isButton = ['contact', 'instagram', 'whatsapp', 'youtube', 'gmail'].includes(elementKey)

  return <div>
    <div className="mb-5 flex items-center justify-between"><h3 className="text-lg font-semibold">{selected?.[1] || 'Footer'}</h3><button onClick={onClose} className="text-xs text-gray-400 hover:text-white">Fechar</button></div>
    {!selected ? <>
      <p className="mb-5 text-sm text-gray-400">Clique num elemento do footer para editar, ou escolha abaixo.</p>
      <div className="grid gap-2">{FOOTER_ELEMENTS.map(([key, label]) => <button key={key} onClick={() => select({ type: 'footerElement', path: key })} className="rounded-lg border border-white/10 px-3 py-3 text-left text-sm hover:border-emerald-400">{label}</button>)}</div>
    </> : <>
      <button onClick={() => select({ type: 'section', path: 'footer', label: 'Footer' })} className="mb-5 text-xs text-emerald-400">← Elementos do footer</button>
      {['contact', 'visit'].includes(elementKey) && <TextField label="Texto" value={resolveText(element.text, language)} onChange={value => set('text', setTextForLanguage(element.text, language, value))} />}
      {isButton && <>
        <TextField label="URL" value={element.url} onChange={value => set('url', value)} />
        {elementKey !== 'contact' && <TextField label="Descrição do botão" value={element.label} onChange={value => set('label', value)} />}
        <SelectField label="Ícone" value={element.icon} onChange={value => set('icon', value)} options={FOOTER_ICONS.map(value => ({ value, label: { none: 'Sem ícone', instagram: 'Instagram', whatsapp: 'WhatsApp', youtube: 'YouTube', gmail: 'Gmail / Email', location: 'Localização', phone: 'Telefone', arrow: 'Seta', globe: 'Globo' }[value] }))} />
      </>}
      {elementKey === 'address' && <TextField label="Morada" value={resolveText(section.address?.text, language)} onChange={value => updateField('sections.footer.address.text', setTextForLanguage(section.address?.text, language, value))} />}
      {elementKey === 'map' && <TextField label="URL do mapa incorporado" value={section.mapEmbedUrl} onChange={value => updateField('sections.footer.mapEmbedUrl', value)} />}
      <p className="mb-4 mt-6 text-xs text-emerald-400">Tamanho e posição — {device}</p>
      <p className="mb-4 text-xs text-gray-500">X move para a direita; Y move para baixo. Valores negativos movem no sentido contrário.</p>
      <NumericField label="Posição horizontal (X)" value={layout.x ?? 0} onChange={value => setLayout('x', value)} />
      <NumericField label="Posição vertical (Y)" value={layout.y ?? 0} onChange={value => setLayout('y', value)} />
      {(isButton || elementKey === 'map') && <>
        <NumericField label="Largura" min={1} value={layout.width === '100%' ? '' : layout.width} onChange={value => setLayout('width', value)} />
        <NumericField label="Altura" min={1} value={layout.height} onChange={value => setLayout('height', value)} />
      </>}
      {isButton && <NumericField label="Tamanho do ícone" min={1} max={200} value={layout.iconSize} onChange={value => setLayout('iconSize', value)} />}
      {['contact', 'visit', 'address'].includes(elementKey) && <NumericField label="Tamanho do texto" min={1} max={200} value={layout.fontSize} onChange={value => setLayout('fontSize', value)} />}
      <button onClick={() => set(`layout.${device}`, {})} className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:border-emerald-400">Repor tamanho e posição neste dispositivo</button>
      <p className="mt-5 text-xs text-gray-500">Use Guardar / Publicar na barra do editor para guardar estas alterações.</p>
    </>}
  </div>
}
