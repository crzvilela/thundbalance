import { blocks } from './legalRender'

// Draws the blocks of a legal text. Everything is a React text node (escaped): a "<script>" typed in a text is shown as text, never run.
// The pending marks ([[...]]) are only drawn when `admin` is true; for everybody else those lines are not even in the blocks.
function Pieces({ items, admin }) {
  return items.map((piece, index) => (piece.mark
    ? (admin ? <mark key={index} className="rounded bg-amber-300/25 px-1 text-amber-200">{piece.text}</mark> : null)
    : <span key={index}>{piece.text}</span>))
}

export default function LegalBlocks({ text, settings, admin = false }) {
  return blocks(text, settings, { admin }).map((block, index) => {
    if (block.type === 'h') return <h2 key={index} className="mt-8 text-xl font-semibold text-white"><Pieces items={block.pieces} admin={admin} /></h2>
    if (block.type === 'ul') {
      return (
        <ul key={index} className="mt-3 list-disc space-y-1.5 pl-6 text-base leading-relaxed text-gray-300">
          {block.items.map((item, i) => <li key={i}><Pieces items={item} admin={admin} /></li>)}
        </ul>
      )
    }
    return <p key={index} className="mt-3 text-base leading-relaxed text-gray-300"><Pieces items={block.pieces} admin={admin} /></p>
  })
}
