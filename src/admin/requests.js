// /admin/client-requests returns rows as arrays:
// [id, clientName, packageName, sessionsPerWeek, preferredDays, preferredTime, status, rejectionReason, archivedAt]
export function normalizeRequests(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map(row => ({
    id: row[0],
    client: row[1] || '—',
    plan: row[2] || '—',
    perWeek: row[3],
    days: String(row[4] || '').split(',').map(day => day.trim()).filter(Boolean),
    time: row[5] || '',
    status: String(row[6] || '').toLowerCase(),
    reason: row[7] || '',
    archived: !!row[8]
  }))
}

// /admin/sessions rows: [id, clientName, trainerName, 'YYYY-MM-DD', 'HH:MM:SS', status]
export function normalizeSessions(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map(row => ({
    id: row[0],
    client: row[1] || '—',
    trainer: row[2] || '—',
    date: String(row[3] || ''),
    time: String(row[4] || '').slice(0, 5),
    status: String(row[5] || '')
  }))
}

export function dateKey(date) {
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}
