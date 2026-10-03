import { useEffect, useRef, useState } from 'react'
import { actualFontFamily, FONT_OPTIONS, loadFont } from '../../utils/fonts'

function FontOption({ font, root, selected, onSelect }) {
  const rowRef = useRef(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const row = rowRef.current
    if (!row || !root) return
    const reveal = () => loadFont(font).then(() => setLoaded(true))
    if (typeof IntersectionObserver === 'undefined') { reveal(); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        reveal()
        observer.disconnect()
      }
    }, { root, rootMargin: '0px' })
    observer.observe(row)
    return () => observer.disconnect()
  }, [font, root])

  return <button ref={rowRef} type="button" onClick={() => onSelect(font)} className={`w-full rounded-md px-3 py-2 text-left hover:bg-white/10 ${selected ? 'bg-emerald-500/15 text-emerald-300' : 'text-gray-200'}`}>
    <span className="block text-sm" style={{ fontFamily: loaded ? `'${actualFontFamily(font)}', sans-serif` : 'sans-serif' }}>{font}</span>
    {!loaded && <span className="block h-px mt-1 w-2/3 bg-white/10 animate-pulse" />}
  </button>
}

export default function FontFamilyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [root, setRoot] = useState(null)
  const options = FONT_OPTIONS.filter(font => font.toLowerCase().includes(query.trim().toLowerCase()))

  return <div className="mb-5 relative">
    <label className="block text-xs uppercase tracking-wider text-gray-400 mb-2">Font Family</label>
    <button type="button" aria-expanded={open} onClick={() => setOpen(current => !current)} className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white text-left hover:border-white/25">
      {value || 'Inherit global default'} <span className="float-right text-gray-500">{open ? '▴' : '▾'}</span>
    </button>
    {open && <div className="absolute z-50 top-full left-0 right-0 mt-1 p-2 bg-[#101010] border border-white/10 rounded-lg shadow-xl">
      <input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search fonts…" aria-label="Search fonts" className="w-full mb-2 bg-[#090909] border border-white/10 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
      <div ref={setRoot} className="max-h-52 overflow-y-auto" role="listbox">
        <button type="button" onClick={() => { onChange(''); setOpen(false) }} className="w-full rounded-md px-3 py-2 text-left text-xs text-gray-400 hover:bg-white/10">Inherit global default</button>
        {options.map(font => <FontOption key={font} font={font} root={root} selected={value === font} onSelect={font => { onChange(font); setOpen(false) }} />)}
        {!options.length && <p className="px-3 py-2 text-xs text-gray-500">No fonts found.</p>}
      </div>
    </div>}
  </div>
}
