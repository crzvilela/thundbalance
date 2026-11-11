// The CLOSED list of what the studio can personalise in the admin panel (names, order, visibility). Nothing outside this list is ever
// stored or shown from the configuration. The server keeps the same keys (backend/admin_ui_settings.py: MENU_KEYS, OVERVIEW_KEYS,
// PAGE_KEYS): when an area, a card or a page is added here, add its key there too (docs/ADMIN_UI_SETTINGS.md).
//
// `labelKey` / `titleKey` / `subtitleKey` are the original texts (adminText.js, ES and EN): they are what is shown when nothing was
// customised. A customised name is one single text for both languages.

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
