import { createContext, useContext, useMemo } from 'react'
import { resolveCustomizeLabel, resolveMenu, resolveOverview, resolvePageText } from './uiSettings'

// What the panel is personalised with (the saved configuration, or the draft while it is being edited). Outside the provider (a page
// rendered on its own, a test) the value is null and every hook answers with the originals: the panel never depends on this.
export const UiSettingsContext = createContext(null)

const NOTHING = {}

export function useUiSettings() {
  return useContext(UiSettingsContext)
}

const useEffectiveSettings = () => useUiSettings()?.effective || NOTHING

// The menu areas in order, with their custom names and whether they are hidden: { items, customizeLabel }.
export function useMenuItems() {
  const settings = useEffectiveSettings()
  return useMemo(() => ({ items: resolveMenu(settings), customizeLabel: resolveCustomizeLabel(settings) }), [settings])
}

// The Overview cards in order with their custom titles and whether they are hidden, and titleOf(key, original).
export function useOverviewCards() {
  const settings = useEffectiveSettings()
  return useMemo(() => {
    const cards = resolveOverview(settings)
    const byKey = new Map(cards.map(card => [card.key, card]))
    return { cards, titleOf: (key, original) => byKey.get(key)?.custom || original }
  }, [settings])
}

// The title and subtitle of a page: the custom ones or the originals given.
export function usePageText(pageKey, defaultTitle, defaultSubtitle) {
  const settings = useEffectiveSettings()
  return useMemo(() => resolvePageText(settings, pageKey, defaultTitle, defaultSubtitle), [settings, pageKey, defaultTitle, defaultSubtitle])
}
