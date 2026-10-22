// Interface text of the trainer area (menu item, /trainer page and its admin view).
// Merged into the main dictionary by translations.js. {name}-style placeholders are filled in by t(key, { name }).
//
// THE MENU ITEM: its name is the single key 'trainer.menuLabel'. Change it here (one line per language) and the
// navbar, the profile menu and the page title follow.

export const trainerText = {
  en: {
    'trainer.menuLabel': 'Trainer panel',

    tr_greeting: 'Hello, {name}',
    tr_subtitle: 'Your sessions, your free hours and your numbers. Everything here is read only.',
    tr_readonly: 'Read only',
    tr_checking: 'Checking your access…',
    tr_forbidden: 'This area is only for trainers.',
    tr_go_home: 'Back to the home page',

    tr_period_label: 'Period',
    tr_period_today: 'Today', tr_period_week: 'Week', tr_period_month: 'Month', tr_period_custom: 'Custom range',
    tr_from: 'From', tr_to: 'To', tr_apply: 'Apply',
    tr_range_missing: 'Choose both dates.',
    tr_range_order: 'The first date can not be after the last one.',
    tr_range_long: 'Choose a range of up to 366 days.',
    tr_range_shown: 'Showing {from} – {to}',

    tr_tabs_label: 'Trainer panel sections',
    tr_tab_insights: 'Insights', tr_tab_calendar: 'Calendar', tr_tab_list: 'List',

    tr_loading: 'Loading…',
    tr_retry: 'Try again',
    tr_error: 'We could not load this information.',
    tr_error_network: 'The connection failed. The server may be waking up: try again in a few seconds.',
    tr_error_forbidden: 'You do not have access to this information.',
    tr_error_range: 'That range is not valid.',

    tr_i_booked: 'Sessions booked', tr_i_completed: 'Completed', tr_i_cancelled: 'Cancelled',
    tr_i_rescheduled: 'Date changes', tr_i_upcoming: 'Next 7 days', tr_i_hours: 'Hours given',
    tr_i_clients: 'Different clients', tr_i_trials: 'Trial sessions', tr_i_free: 'Free hours',
    tr_i_hours_unit: '{n} h',
    tr_chart_weekdays: 'Busiest days of the week',
    tr_chart_hours: 'Busiest hours of the day',
    tr_chart_none: 'No sessions in this period yet.',
    tr_chart_value: '{n} sessions',
    tr_chart_value_one: '1 session',

    tr_cal_today: 'Today', tr_cal_day: 'Day', tr_cal_week: 'Week', tr_cal_month: 'Month',
    tr_cal_more: 'more',
    tr_cal_free: 'Free', tr_cal_trial: 'Trial',
    tr_cal_legend: 'Calendar key',
    tr_cal_legend_session: 'Your session', tr_cal_legend_trial: 'Trial session', tr_cal_legend_free: 'Free hour',
    tr_cal_legend_cancelled: 'Cancelled',
    tr_cal_empty: 'No sessions in this view.',

    tr_list_filter: 'Filter by status',
    tr_f_all: 'All', tr_f_booked: 'Booked', tr_f_completed: 'Completed', tr_f_cancelled: 'Cancelled',
    tr_list_empty: 'No sessions in this period.',
    tr_list_empty_filter: 'No sessions with this status in this period.',
    tr_list_today: 'Today', tr_list_open: 'Open the details of {name}, {when}',

    tr_status_booked: 'Booked', tr_status_completed: 'Completed', tr_status_cancelled: 'Cancelled',
    tr_trial: 'Trial',

    tr_modal_title: 'Session details',
    tr_modal_client: 'Client', tr_modal_session: 'Session', tr_modal_pack: 'Pack',
    tr_modal_date: 'Date', tr_modal_time: 'Time', tr_modal_status: 'Status',
    tr_modal_note: 'Read only. Changes are made by the studio.',
    tr_close: 'Close',

    tr_admin_banner: 'Read-only view of the panel of {name}',
    tr_back: 'Back',
    tr_admin_not_found: 'This trainer could not be found.'
  },
  es: {
    'trainer.menuLabel': 'Panel de entrenador',

    tr_greeting: 'Hola, {name}',
    tr_subtitle: 'Tus sesiones, tus horas libres y tus números. Todo es de solo lectura.',
    tr_readonly: 'Solo lectura',
    tr_checking: 'Comprobando tu acceso…',
    tr_forbidden: 'Esta área es solo para entrenadores.',
    tr_go_home: 'Volver al inicio',

    tr_period_label: 'Período',
    tr_period_today: 'Hoy', tr_period_week: 'Semana', tr_period_month: 'Mes', tr_period_custom: 'Rango personalizado',
    tr_from: 'Desde', tr_to: 'Hasta', tr_apply: 'Aplicar',
    tr_range_missing: 'Elige las dos fechas.',
    tr_range_order: 'La primera fecha no puede ser posterior a la última.',
    tr_range_long: 'Elige un rango de hasta 366 días.',
    tr_range_shown: 'Mostrando {from} – {to}',

    tr_tabs_label: 'Secciones del panel de entrenador',
    tr_tab_insights: 'Insights', tr_tab_calendar: 'Calendario', tr_tab_list: 'Lista',

    tr_loading: 'Cargando…',
    tr_retry: 'Reintentar',
    tr_error: 'No pudimos cargar esta información.',
    tr_error_network: 'Falló la conexión. Puede que el servidor se esté despertando: inténtalo de nuevo en unos segundos.',
    tr_error_forbidden: 'No tienes acceso a esta información.',
    tr_error_range: 'Ese rango no es válido.',

    tr_i_booked: 'Sesiones reservadas', tr_i_completed: 'Completadas', tr_i_cancelled: 'Canceladas',
    tr_i_rescheduled: 'Cambios de fecha', tr_i_upcoming: 'Próximos 7 días', tr_i_hours: 'Horas impartidas',
    tr_i_clients: 'Clientes distintos', tr_i_trials: 'Trial sessions', tr_i_free: 'Horas libres',
    tr_i_hours_unit: '{n} h',
    tr_chart_weekdays: 'Días de la semana más ocupados',
    tr_chart_hours: 'Horas del día más ocupadas',
    tr_chart_none: 'Todavía no hay sesiones en este período.',
    tr_chart_value: '{n} sesiones',
    tr_chart_value_one: '1 sesión',

    tr_cal_today: 'Hoy', tr_cal_day: 'Día', tr_cal_week: 'Semana', tr_cal_month: 'Mes',
    tr_cal_more: 'más',
    tr_cal_free: 'Libre', tr_cal_trial: 'Trial',
    tr_cal_legend: 'Leyenda del calendario',
    tr_cal_legend_session: 'Tu sesión', tr_cal_legend_trial: 'Sesión de prueba', tr_cal_legend_free: 'Hora libre',
    tr_cal_legend_cancelled: 'Cancelada',
    tr_cal_empty: 'No hay sesiones en esta vista.',

    tr_list_filter: 'Filtrar por estado',
    tr_f_all: 'Todas', tr_f_booked: 'Reservadas', tr_f_completed: 'Completadas', tr_f_cancelled: 'Canceladas',
    tr_list_empty: 'No hay sesiones en este período.',
    tr_list_empty_filter: 'No hay sesiones con este estado en este período.',
    tr_list_today: 'Hoy', tr_list_open: 'Abrir los detalles de {name}, {when}',

    tr_status_booked: 'Reservada', tr_status_completed: 'Completada', tr_status_cancelled: 'Cancelada',
    tr_trial: 'Trial',

    tr_modal_title: 'Detalles de la sesión',
    tr_modal_client: 'Cliente', tr_modal_session: 'Sesión', tr_modal_pack: 'Pack',
    tr_modal_date: 'Fecha', tr_modal_time: 'Hora', tr_modal_status: 'Estado',
    tr_modal_note: 'Solo lectura. Los cambios los hace el estudio.',
    tr_close: 'Cerrar',

    tr_admin_banner: 'Vista de solo lectura del panel de {name}',
    tr_back: 'Volver',
    tr_admin_not_found: 'No se encontró a este entrenador.'
  },
  ca: {
    'trainer.menuLabel': "Panell d'entrenador",

    tr_greeting: 'Hola, {name}',
    tr_subtitle: 'Les teves sessions, les teves hores lliures i els teus números. Tot és de només lectura.',
    tr_readonly: 'Només lectura',
    tr_checking: "Comprovant el teu accés…",
    tr_forbidden: 'Aquesta àrea és només per a entrenadors.',
    tr_go_home: "Tornar a l'inici",

    tr_period_label: 'Període',
    tr_period_today: 'Avui', tr_period_week: 'Setmana', tr_period_month: 'Mes', tr_period_custom: 'Rang personalitzat',
    tr_from: 'Des de', tr_to: 'Fins a', tr_apply: 'Aplicar',
    tr_range_missing: 'Tria les dues dates.',
    tr_range_order: "La primera data no pot ser posterior a l'última.",
    tr_range_long: "Tria un rang de fins a 366 dies.",
    tr_range_shown: 'Mostrant {from} – {to}',

    tr_tabs_label: "Seccions del panell d'entrenador",
    tr_tab_insights: 'Insights', tr_tab_calendar: 'Calendari', tr_tab_list: 'Llista',

    tr_loading: 'Carregant…',
    tr_retry: 'Torna-ho a provar',
    tr_error: "No hem pogut carregar aquesta informació.",
    tr_error_network: 'Ha fallat la connexió. Pot ser que el servidor s’estigui despertant: torna-ho a provar d’aquí a uns segons.',
    tr_error_forbidden: 'No tens accés a aquesta informació.',
    tr_error_range: 'Aquest rang no és vàlid.',

    tr_i_booked: 'Sessions reservades', tr_i_completed: 'Completades', tr_i_cancelled: 'Cancel·lades',
    tr_i_rescheduled: 'Canvis de data', tr_i_upcoming: 'Pròxims 7 dies', tr_i_hours: 'Hores impartides',
    tr_i_clients: 'Clients diferents', tr_i_trials: 'Trial sessions', tr_i_free: 'Hores lliures',
    tr_i_hours_unit: '{n} h',
    tr_chart_weekdays: 'Dies de la setmana més ocupats',
    tr_chart_hours: 'Hores del dia més ocupades',
    tr_chart_none: 'Encara no hi ha sessions en aquest període.',
    tr_chart_value: '{n} sessions',
    tr_chart_value_one: '1 sessió',

    tr_cal_today: 'Avui', tr_cal_day: 'Dia', tr_cal_week: 'Setmana', tr_cal_month: 'Mes',
    tr_cal_more: 'més',
    tr_cal_free: 'Lliure', tr_cal_trial: 'Trial',
    tr_cal_legend: 'Llegenda del calendari',
    tr_cal_legend_session: 'La teva sessió', tr_cal_legend_trial: 'Sessió de prova', tr_cal_legend_free: 'Hora lliure',
    tr_cal_legend_cancelled: 'Cancel·lada',
    tr_cal_empty: 'No hi ha sessions en aquesta vista.',

    tr_list_filter: 'Filtrar per estat',
    tr_f_all: 'Totes', tr_f_booked: 'Reservades', tr_f_completed: 'Completades', tr_f_cancelled: 'Cancel·lades',
    tr_list_empty: 'No hi ha sessions en aquest període.',
    tr_list_empty_filter: 'No hi ha sessions amb aquest estat en aquest període.',
    tr_list_today: 'Avui', tr_list_open: 'Obrir els detalls de {name}, {when}',

    tr_status_booked: 'Reservada', tr_status_completed: 'Completada', tr_status_cancelled: 'Cancel·lada',
    tr_trial: 'Trial',

    tr_modal_title: 'Detalls de la sessió',
    tr_modal_client: 'Client', tr_modal_session: 'Sessió', tr_modal_pack: 'Pack',
    tr_modal_date: 'Data', tr_modal_time: 'Hora', tr_modal_status: 'Estat',
    tr_modal_note: "Només lectura. Els canvis els fa l'estudi.",
    tr_close: 'Tanca',

    tr_admin_banner: 'Vista de només lectura del panell de {name}',
    tr_back: 'Tornar',
    tr_admin_not_found: "No s'ha trobat aquest entrenador."
  }
}
