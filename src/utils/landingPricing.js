// Which packs the Pricing section of the landing page shows (see backend/landing_pricing.py).
//
// The section keeps its own list, `section.planItems = [{ plan_id, visible, card }]`, in the order of the page:
//   plan_id  the pack of the catalogue (its name, price, goal and benefits are read live from GET /pricing)
//   visible  false = kept in the list, not drawn
//   card     index in `section.plans` of the text card (description, features, button) the pack uses, or null (plain card)
// Creating a pack never adds it here: the admin does it from the editor. A pack that was archived or deleted is skipped
// in silence (it stays in the list, so restoring the pack brings it back).

export const itemsOf = (section) => (Array.isArray(section?.planItems) ? section.planItems.filter(item => item && item.plan_id != null) : [])

// What the page draws for one session type: [{ item, pack, cardIndex }] (visible items whose pack is on sale).
export function entriesFor(section, packs, sessionType) {
  const onSale = new Map((Array.isArray(packs) ? packs : []).map(pack => [pack.id, pack]))
  const entries = []
  for (const item of itemsOf(section)) {
    const pack = onSale.get(item.plan_id)
    if (!pack || item.visible === false || pack.session_type !== sessionType) continue
    const cards = Array.isArray(section?.plans) ? section.plans : []
    const cardIndex = Number.isInteger(item.card) && item.card >= 0 && item.card < cards.length ? item.card : null
    entries.push({ item, pack, cardIndex })
  }
  return entries
}

// The packs on sale that are not in the list yet (what "Añadir plan" offers).
export function availablePacks(packs, section) {
  const used = new Set(itemsOf(section).map(item => item.plan_id))
  return (Array.isArray(packs) ? packs : []).filter(pack => !used.has(pack.id))
}

// Adds a pack to the end of the list with a new plain text card (the look of the last card, empty description and features).
// Returns { planItems, plans } or null when the pack is already there.
export function addPack(section, packId, blankCard) {
  const items = itemsOf(section)
  if (items.some(item => item.plan_id === packId)) return null
  const plans = Array.isArray(section?.plans) ? section.plans : []
  return {
    planItems: [...items, { plan_id: packId, visible: true, card: plans.length }],
    plans: [...plans, blankCard],
  }
}

export const removeAt = (items, index) => items.filter((_item, at) => at !== index)

export const setVisible = (items, index, visible) => items.map((item, at) => (at === index ? { ...item, visible } : item))

// Moves the item at `from` to the place `to` (drag and drop, and the up / down buttons with a step of one).
export function reorder(items, from, to) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
