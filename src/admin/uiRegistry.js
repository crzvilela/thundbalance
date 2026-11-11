// The CLOSED list of what the studio can personalise in the admin panel (names, order, visibility). Nothing outside this list is ever
// stored or shown from the configuration. The server keeps the same keys (backend/admin_ui_settings.py: MENU_KEYS, OVERVIEW_KEYS,
// PAGE_KEYS): when an area, a card or a page is added here, add its key there too (docs/ADMIN_UI_SETTINGS.md).
//
// `labelKey` / `titleKey` / `subtitleKey` are the original texts (adminText.js, ES and EN): they are what is shown when nothing was
// customised. A customised name is one single text for both languages.

import { TEXTS } from './uiTexts.js'

export const LABEL_MAX = 30          // names of menu items, card titles, page titles
export const SUBTITLE_MAX = 120      // page subtitles
export const MIN_VISIBLE_AREAS = 3   // menu areas that must always stay visible

// The menu, in its original order. `protected`: can never be hidden.
export const MENU_ITEMS = [
  { key: 'overview', to: '/admin', end: true, icon: 'overview', labelKey: 'nav_overview', protected: true },
  { key: 'requests', to: '/admin/requests', icon: 'requests', labelKey: 'nav_requests', badge: 'requests' },
  { key: 'trials', to: '/admin/trials', icon: 'whistle', labelKey: 'nav_trials', badge: 'trials' },
  { key: 'messages', to: '/admin/messages', icon: 'inbox', labelKey: 'nav_messages', badge: 'messages' },
  { key: 'sent-messages', to: '/admin/sent-messages', icon: 'send', labelKey: 'nav_broadcast' },
  { key: 'clients', to: '/admin/clients', icon: 'clients', labelKey: 'nav_clients' },
  { key: 'calendar', to: '/admin/calendar', icon: 'calendar', labelKey: 'nav_sessions' },
  { key: 'schedule', to: '/admin/schedule', icon: 'refresh', labelKey: 'nav_schedule', badge: 'schedule' },
  { key: 'trainers', to: '/admin/trainers', icon: 'clock', labelKey: 'nav_trainers' },
  { key: 'plans', to: '/admin/plans', icon: 'bolt', labelKey: 'nav_plans' },
  { key: 'videos', to: '/admin/videos', icon: 'video', labelKey: 'nav_videos' },
  { key: 'landing', to: '/admin/landing-editor', icon: 'landing', labelKey: 'nav_landing', arrow: true }
]

// The button that opens the editor. It is not an area: it always stays at the end of the menu and can never be hidden (it can be renamed).
export const CUSTOMIZE_KEY = 'customize'
export const CUSTOMIZE_LABEL_KEY = 'ui_customize'
export const PROTECTED_MENU_KEYS = ['overview', CUSTOMIZE_KEY]

// The cards of the Overview, in their original order. `group`: stat (the small number cards), card (the big cards, `span` of 5 columns)
// or business (the full-width business panel).
export const OVERVIEW_CARDS = [
  { key: 'stat_clients', titleKey: 'stat_clients', group: 'stat' },
  { key: 'stat_sessions', titleKey: 'stat_sessions', group: 'stat' },
  { key: 'stat_pending', titleKey: 'stat_pending_total', group: 'stat' },
  { key: 'week', titleKey: 'week_title', group: 'card', span: 3 },
  { key: 'pending', titleKey: 'pending_title', group: 'card', span: 2 },
  { key: 'business', titleKey: 'biz_title', group: 'business' },
  { key: 'upcoming', titleKey: 'upcoming_title', group: 'card', span: 3 },
  { key: 'quick', titleKey: 'quick_title', group: 'card', span: 2 }
]

// Pages with a title and a subtitle (PageHeader). The Overview title is a fixed brand text in every language.
export const PAGES = [
  { key: 'overview', title: 'THUNDBALANCE ADMIN', subtitleKey: 'overview_sub' },
  { key: 'requests', titleKey: 'req_title', subtitleKey: 'req_sub' },
  { key: 'trials', titleKey: 'tr_title', subtitleKey: 'tr_sub' },
  { key: 'messages', titleKey: 'msg_title', subtitleKey: 'msg_sub' },
  { key: 'sent-messages', titleKey: 'bx_title', subtitleKey: 'bx_sub' },
  { key: 'clients', titleKey: 'clients_title', subtitleKey: 'clients_sub' },
  { key: 'calendar', titleKey: 'ac_title', subtitleKey: 'ac_sub' },
  { key: 'schedule', titleKey: 'sch_title', subtitleKey: 'sch_sub' },
  { key: 'trainers', titleKey: 'tn_title', subtitleKey: 'tn_sub' },
  { key: 'plans', titleKey: 'cat_title', subtitleKey: 'cat_sub' },
  { key: 'videos', titleKey: 'videos_title', subtitleKey: 'vd_sub' }
]

export const MENU_KEYS = MENU_ITEMS.map(item => item.key)
export const OVERVIEW_KEYS = OVERVIEW_CARDS.map(card => card.key)
export const PAGE_KEYS = PAGES.map(page => page.key)

// ---------------------------------------------------------------------------------------------------------------------------------
// The texts that can be edited ON the panel itself (inline editing). One entry per text: `path` is the key the <Editable> component takes
// (keyPath), `defaultKey` the original text in adminText.js (ES / EN) or `defaultText` a fixed one, `max` the limit of characters.
//   menu:<menuKey>              the name of a menu item (and "menu:customize" the one of the "Personalizar panel" button)
//   overview:<cardKey>          the title of an Overview card
//   page:<pageKey>:title        the title of a page          page:<pageKey>:subtitle   its subtitle
// To make a NEW text editable (Phase 2): add its area / card / page above, then use <Editable keyPath="..." defaultText={original} /> where it
// is drawn (docs/ADMIN_UI_SETTINGS.md).
export const EDITABLE_TEXTS = [
  ...MENU_ITEMS.map(item => ({ path: `menu:${item.key}`, kind: 'menu', defaultKey: item.labelKey, max: LABEL_MAX })),
  { path: `menu:${CUSTOMIZE_KEY}`, kind: 'menu', defaultKey: CUSTOMIZE_LABEL_KEY, max: LABEL_MAX },
  ...OVERVIEW_CARDS.map(card => ({ path: `overview:${card.key}`, kind: 'overview', defaultKey: card.titleKey, max: LABEL_MAX })),
  ...PAGES.flatMap(page => [
    { path: `page:${page.key}:title`, kind: 'page', defaultKey: page.titleKey, defaultText: page.title, max: LABEL_MAX },
    { path: `page:${page.key}:subtitle`, kind: 'page', defaultKey: page.subtitleKey, max: SUBTITLE_MAX }
  ]),
  // the texts inside the pages (section titles, table headers, filters, main buttons, empty-list messages): uiTexts.js, `text:<page>.<element>`
  ...TEXTS.map(entry => ({ path: `text:${entry.key}`, kind: 'text', page: entry.page, defaultKey: entry.defaultKey, max: entry.max }))
]

export const TEXT_ENTRIES = TEXTS
export const TEXT_KEYS = TEXTS.map(entry => entry.key)

export const editableText = (path) => EDITABLE_TEXTS.find(entry => entry.path === path) || null

// ---------------------------------------------------------------------------------------------------------------------------------
// BLOCKS: whole parts of a page that the studio can move up / down and hide (never fields, table rows or the content of a block).
//   BLOCKS[page][group] = [{ key, labelKey (ES / EN in adminText.js), protected?, span? }] in the ORIGINAL order.
// A block moves only inside its own group of its page, so the layout cannot break. A protected block is never hidden (it can still be moved),
// and every page always keeps at least one visible block. `span` (of 5 columns) is used by the groups that lay their blocks out in rows.
// The server keeps the same lists (backend/admin_ui_settings.py: BLOCK_GROUPS, PROTECTED_BLOCKS): add a block to BOTH (docs/ADMIN_UI_SETTINGS.md).
export const BLOCKS = {
  overview: {
    business: [
      { key: 'biz_stats', labelKey: 'blk_biz_stats', span: 5 },
      { key: 'biz_ending', labelKey: 'blk_biz_ending', span: 3 },
      { key: 'biz_trainer', labelKey: 'blk_biz_trainer', span: 2 },
      { key: 'biz_nopack', labelKey: 'blk_biz_nopack', span: 5 }
    ]
  },
  plans: {
    main: [
      { key: 'on_sale', labelKey: 'blk_plans_on_sale', protected: true },
      { key: 'archived', labelKey: 'blk_plans_archived' },
      { key: 'trial_prices', labelKey: 'blk_plans_trial' }
    ]
  },
  calendar: {
    main: [
      { key: 'filters', labelKey: 'blk_cal_filters' },
      { key: 'legend', labelKey: 'blk_cal_legend' },
      { key: 'calendar', labelKey: 'blk_cal_calendar', protected: true }
    ]
  },
  trainers: {
    main: [
      { key: 'note', labelKey: 'blk_tn_note' },
      { key: 'access', labelKey: 'blk_tn_access', protected: true },
      { key: 'list', labelKey: 'blk_tn_list', protected: true }
    ]
  },
  schedule: {
    main: [
      { key: 'tabs', labelKey: 'blk_sch_tabs', protected: true },
      { key: 'trainer_filter', labelKey: 'blk_sch_trainers' },
      { key: 'list', labelKey: 'blk_sch_list', protected: true }
    ]
  }
}

export const BLOCK_PAGES = Object.keys(BLOCKS)

// The groups that lay their blocks out in rows of 5 columns (the rest simply stack, one block under the other).
export const GRID_GROUPS = ['overview.business']

export const blocksOf = (page, group) => BLOCKS[page]?.[group] || null
export const protectedBlocks = (page) => Object.values(BLOCKS[page] || {}).flat().filter(block => block.protected).map(block => block.key)
