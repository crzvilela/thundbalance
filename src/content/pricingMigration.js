// The recommended pricing plan used to have "Most Popular" as the TEXT OF ITS BUTTON (a label, not an action). The label is now a ribbon
// above the card and the button says "Get Started". Only the untouched old default is replaced, once: a text the admin wrote stays.
const OLD_POPULAR = [['Most Popular', 'Más Popular', 'Més Popular']]
export function migratePricingButton(content) {
  if (!content?.sections || content.pricingButtonVersion >= 1) return content
  const next = structuredClone(content)
  for (const section of Object.values(next.sections)) {
    if (!section || section.type !== 'pricing' || !Array.isArray(section.plans)) continue
    for (const plan of section.plans) {
      if (!plan || !plan.highlighted) continue
      const text = plan.buttonText
      const isOld = typeof text === 'string'
        ? OLD_POPULAR.some(set => set.includes(text))
        : Boolean(text) && OLD_POPULAR.some(([en, es, ca]) => text.en === en && (text.es === undefined || text.es === es) && (text.ca === undefined || text.ca === ca))
      if (isOld) plan.buttonText = { en: 'Get Started', es: 'Empezar', ca: 'Començar' }
    }
  }
  next.pricingButtonVersion = 1
  return next
}
