import { useLandingContent } from '../../content/LandingContentContext'
import { heroTitleLayout } from '../../utils/heroTitle'
import { NumberField, SmallButton } from './fields'

// Numeric version of dragging the hero title: same values, per device.
export default function HeroTitleFields() {
  const { content, device, updateField } = useLandingContent()
  const layout = heroTitleLayout(content.sections.hero?.titleLayout, device)
  const path = `sections.hero.titleLayout.${device}`
  const set = (key, value) => updateField(`${path}.${key}`, value === '' ? null : Number.parseFloat(value))

  return (
    <div className="mt-6">
      <p className="mb-2 text-sm text-emerald-400">Posição e largura do título — {device}</p>
      <p className="mb-4 text-xs text-gray-500">Com o título selecionado, arraste-o na página para mover, ou use os campos abaixo.</p>
      <NumberField label="Posição horizontal do título (X)" value={layout.x} onChange={value => set('x', value)} />
      <NumberField label="Posição vertical do título (Y)" value={layout.y} onChange={value => set('y', value)} />
      <NumberField label="Largura do texto (vazio = automática)" value={layout.width ?? ''} onChange={value => set('width', value)} placeholder="auto" />
      <p className="mb-4 text-xs text-gray-500">X move para a direita; Y move para baixo. Use valores negativos para mover no sentido contrário. Os ajustes são separados por dispositivo.</p>
      <SmallButton onClick={() => updateField(path, {})}>Repor posição e largura</SmallButton>
    </div>
  )
}
