import { useLandingContent } from '../../content/LandingContentContext'
import { navbarLogoLayout } from '../../utils/navbarLogo'
import { NumberField, SmallButton } from './fields'

export default function NavbarLogoFields() {
  const { content, device, updateField } = useLandingContent()
  const layout = navbarLogoLayout(content.sections.navbar?.logoLayout, device)
  const set = (key, value) => updateField(`sections.navbar.logoLayout.${device}.${key}`, value === '' ? null : Number.parseFloat(value))
  return <div className="mt-6">
    <p className="mb-4 text-sm text-emerald-400">Tamanho e posição da logo — {device}</p>
    <NumberField label="Largura da logo" value={layout.width} onChange={value => set('width', value)} />
    <NumberField label="Altura da logo" value={layout.height} onChange={value => set('height', value)} />
    <NumberField label="Posição horizontal da logo (X)" value={layout.x} onChange={value => set('x', value)} />
    <NumberField label="Posição vertical da logo (Y)" value={layout.y} onChange={value => set('y', value)} />
    <p className="mb-2 text-xs text-gray-400">Com a logo selecionada, arraste-a no menu para mover e use as bolinhas dos cantos para redimensionar (mantém a proporção).</p>
    <p className="mb-4 text-xs text-gray-500">X move para a direita; Y move para baixo. Use valores negativos para mover no sentido contrário. Os ajustes são separados por dispositivo.</p>
    <SmallButton onClick={() => updateField(`sections.navbar.logoLayout.${device}`, {})}>Repor tamanho e posição</SmallButton>
  </div>
}
