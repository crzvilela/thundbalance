// node --test src/utils/
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addMinutes, clientSessionTitle, formatDay, formatShortDay, formatTime, googleCalendarUrl, madridNow, sessionStatus, weekdayNames
} from './sessionDates.js'

const norm = (text) => text.replaceAll('’', "'").replaceAll(',', '')

test('dates are written in the language of the site', () => {
  assert.equal(norm(formatDay('2026-10-19', 'es-ES')), 'lunes 19 de octubre de 2026')
  assert.equal(norm(formatDay('2026-10-19', 'en-GB')), 'Monday 19 October 2026')
  assert.match(norm(formatDay('2026-10-19', 'ca-ES')), /^dilluns 19 d'octubre del? 2026$/)   // CLDR writes "del 2026"
})

test('the day never slips to a neighbouring day, even at month ends', () => {
  assert.equal(norm(formatDay('2026-12-31', 'es-ES', { year: false })), 'jueves 31 de diciembre')
  assert.equal(norm(formatDay('2027-01-01', 'en-GB')), 'Friday 1 January 2027')
  assert.match(formatShortDay('2026-10-19', 'es-ES'), /lun/i)
})

test('the week starts on Monday in every language', () => {
  assert.match(weekdayNames('es-ES')[0], /lun/i)
  assert.match(weekdayNames('en-GB')[0], /mon/i)
  assert.match(weekdayNames('ca-ES')[0], /dl|dil/i)
})

test('the time is a 24-hour HH:MM', () => {
  assert.equal(formatTime('09:00:00'), '09:00')
  assert.equal(formatTime('18:30'), '18:30')
})

test('the title is the same as in the e-mail and the .ics', () => {
  assert.equal(clientSessionTitle('Matilda', '1/12'), 'ThundBalance · Sesión con Matilda 1/12')
  assert.equal(clientSessionTitle('Matilda Ruiz', null), 'ThundBalance · Sesión con Matilda')
  assert.equal(clientSessionTitle('', '2/4'), 'ThundBalance · Sesión 2/4')
})

test('the Google Calendar link has local time, ctz, title, place and 60 minutes', () => {
  const url = new URL(googleCalendarUrl({ date: '2026-10-19', time: '10:00:00', trainer: 'Matilda', number: '1/12' }, 'Entrenador: Matilda\nlunes, 10:00'))
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render')
  assert.equal(url.searchParams.get('action'), 'TEMPLATE')
  assert.equal(url.searchParams.get('text'), 'ThundBalance · Sesión con Matilda 1/12')
  assert.equal(url.searchParams.get('dates'), '20261019T100000/20261019T110000')   // local, no trailing Z
  assert.equal(url.searchParams.get('ctz'), 'Europe/Madrid')
  assert.equal(url.searchParams.get('location'), 'ThundBalance, Carrer de Pallars 286, Barcelona')
  assert.equal(url.searchParams.get('details'), 'Entrenador: Matilda\nlunes, 10:00')
  assert.ok(!url.searchParams.get('dates').includes('Z'))
})

test('a session that ends after midnight rolls the end date over', () => {
  assert.deepEqual(addMinutes('2026-10-19', '23:30', 60), { date: '2026-10-20', time: '00:30' })
  const url = new URL(googleCalendarUrl({ date: '2026-12-31', time: '23:30', trainer: 'A', number: '' }))
  assert.equal(url.searchParams.get('dates'), '20261231T233000/20270101T003000')
})

test('Madrid time is used to decide what is completed (summer UTC+2, winter UTC+1)', () => {
  assert.deepEqual(madridNow(new Date(Date.UTC(2026, 9, 19, 8, 30))), { date: '2026-10-19', time: '10:30' })
  assert.deepEqual(madridNow(new Date(Date.UTC(2026, 11, 19, 8, 30))), { date: '2026-12-19', time: '09:30' })
  const at = new Date(Date.UTC(2026, 9, 19, 8, 30))                        // 10:30 in Madrid
  assert.equal(sessionStatus({ date: '2026-10-19', time: '10:00', status: 'Booked' }, at), 'upcoming')   // still running
  assert.equal(sessionStatus({ date: '2026-10-19', time: '09:00', status: 'Booked' }, at), 'completed')  // ended 10:00
  assert.equal(sessionStatus({ date: '2026-10-20', time: '09:00', status: 'Booked' }, at), 'upcoming')
  assert.equal(sessionStatus({ date: '2026-10-20', time: '09:00', status: 'Booked', rescheduled: true }, at), 'rescheduled')
  assert.equal(sessionStatus({ date: '2026-10-20', time: '09:00', status: 'Cancelled' }, at), 'cancelled')
  assert.equal(sessionStatus({ date: '2026-10-10', time: '09:00', status: 'Cancelled' }, at), 'cancelled')  // cancelled wins
})
