import { useLandingContent } from '../../content/LandingContentContext'
import { deviceLayout, getElementLayout, layoutPath, resizesHeight, resizesWidth } from '../../utils/layout'
import { NumberField, SmallButton } from './fields'

// The numbers behind dragging, for any element: where it sits and how big it
// is on the device being edited. Typing here and dragging in the page write the
// same values.
export default function PositionFields({ path, kind }) {
  const { content, device, updateField } = useLandingContent()
  const value = deviceLayout(getElementLayout(content, path), device)
  const target = `${layoutPath(path)}.${device}`

  const current = () => ({
    x: value.x,
    y: value.y,
    ...(value.width !== null ? { width: value.width } : {}),
    ...(value.height !== null ? { height: value.height } : {})
  })
  const set = (key, raw) => {
    const next = current()
    if (raw === '' && (key === 'width' || key === 'height')) delete next[key]
    else next[key] = Number.parseFloat(raw) || 0
    updateField(target, next)
  }

  return (
    <div className="mt-6 mb-2">
      <p className="mb-1 text-sm text-emerald-400">Posição — {device}</p>
      <p className="mb-4 text-xs text-gray-500">Arraste o elemento na página, ou ajuste aqui com números.</p>
      <div className="grid grid-cols-2 gap-x-3">
        <NumberField label="Horizontal (X)" value={value.x} onChange={(raw) => set('x', raw)} />
        <NumberField label="Vertical (Y)" value={value.y} onChange={(raw) => set('y', raw)} />
        {resizesWidth(kind) && <NumberField label="Largura" value={value.width ?? ''} onChange={(raw) => set('width', raw)} placeholder="auto" />}
        {resizesHeight(kind) && <NumberField label="Altura" value={value.height ?? ''} onChange={(raw) => set('height', raw)} placeholder="auto" />}
      </div>
      <SmallButton onClick={() => updateField(target, {})}>Repor posição e tamanho</SmallButton>
    </div>
  )
}
