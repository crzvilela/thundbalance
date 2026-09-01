// Converts pre-Phase-2 content (fixed section keys: about, services,
// pricing, testimonials, contact — no `type` field) into the dynamic
// "section instances" shape (unique IDs, each with a `type`). Runs in
// memory every time content is loaded (see LandingContentContext.jsx), so
// old drafts/published/default_base content keeps working without ever
// needing a one-off database migration script. If the admin then hits Save,
// the migrated (ID-based) shape is what gets persisted going forward.
//
// Hero, Navbar and Footer are untouched by this — they were never part of
// the dynamic system and don't get a `type` or a generated ID.

import { deepMerge, deepClone } from '../utils/objectPath'
import { generateSectionId, SECTION_TYPE_DEFAULTS } from './defaultContent'

const LEGACY_MIDDLE_SECTION_KEYS = ['about', 'services', 'pricing', 'testimonials', 'contact']
const FIXED_KEYS = ['hero', 'navbar', 'footer']

export function migrateSectionsToInstances(content) {
  const sections = content?.sections || {}

  // Legacy shape = at least one of the 5 known middle-section keys exists
  // directly in `sections` without a `type` field. Content that's already
  // been migrated (or was seeded fresh with `type` baked in) is left alone.
  const isLegacyShape = LEGACY_MIDDLE_SECTION_KEYS.some(
    key => sections[key] && sections[key].type === undefined
  )

  if (!isLegacyShape) return content

  const next = deepClone(content)
  const nextSections = { ...next.sections }
  const legacyOrder = (next.sectionOrder && next.sectionOrder.length)
    ? next.sectionOrder
    : ['hero', ...LEGACY_MIDDLE_SECTION_KEYS]

  const newOrder = []
  const migrateKey = (key) => {
    const legacySection = nextSections[key]
    if (!legacySection || legacySection.type !== undefined) return

    const template = SECTION_TYPE_DEFAULTS[key] ? SECTION_TYPE_DEFAULTS[key]() : { type: key, visible: true }
    const id = generateSectionId()

    // deepMerge backfills any field a very old save predates (e.g. the
    // Phase 1 `background`/style objects) while every one of the admin's
    // actual saved values (title, body, items, colors...) still wins.
    nextSections[id] = deepMerge(template, { ...legacySection, type: key })
    delete nextSections[key]
    newOrder.push(id)
  }

  for (const key of legacyOrder) {
    if (FIXED_KEYS.includes(key)) continue

    const existing = nextSections[key]
    if (existing && existing.type !== undefined) {
      // Already ID-based (has a `type`) — nothing to migrate, keep as-is.
      // Guards against a hypothetical mixed legacy/migrated sectionOrder so
      // an already-typed entry is never silently dropped.
      newOrder.push(key)
      continue
    }

    migrateKey(key)
  }

  // Defensive: migrate any legacy key that existed but wasn't listed in
  // sectionOrder, so content is never silently dropped.
  for (const key of LEGACY_MIDDLE_SECTION_KEYS) {
    if (nextSections[key] && nextSections[key].type === undefined) {
      migrateKey(key)
    }
  }

  next.sections = nextSections
  next.sectionOrder = newOrder

  return next
}

// Phase 3 added an explicit background.type ('color' | 'image' | 'video').
// Content saved before that has no `type` at all — if we let deepMerge
// against the new default shape fill it in, EVERY old background would
// silently become 'color' (the new default), even ones that actually have
// an image set, which would hide the image's controls in the properties
// panel (the image itself still renders fine either way, since the render
// layer only special-cases 'video' — but the panel needs the right type
// selected). Runs pre-merge, same pattern as migrateSectionsToInstances,
// and works regardless of whether sections are still legacy-keyed or
// already ID-based dynamic instances.
export function migrateBackgroundTypes(content) {
  const sections = content?.sections
  if (!sections) return content

  const needsMigration = Object.values(sections).some(
    (section) => section?.background && section.background.type === undefined
  )
  if (!needsMigration) return content

  const next = deepClone(content)

  for (const section of Object.values(next.sections)) {
    const bg = section?.background
    if (bg && bg.type === undefined) {
      bg.type = bg.image ? 'image' : 'color'
    }
  }

  return next
}
