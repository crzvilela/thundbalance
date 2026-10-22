// node --test src/utils/
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addMinutes, canRequestChange, clientSessionTitle, formatDay, formatShortDay, formatTime, googleCalendarUrl, madridNow, minutesUntil, sessionStatus, weekdayNames
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

test('a change can be requested up to the notice hours before the session, counted in real hours (the number is a parameter)', () => {
  const HOURS = 24                                                          // what GET /features says today; the page never writes it
  const now = new Date(Date.UTC(2026, 9, 19, 6, 0))                         // 08:00 in Madrid (summer time)
  assert.equal(minutesUntil({ date: '2026-10-19', time: '16:00' }, now), 480)
  assert.equal(canRequestChange({ date: '2026-10-20', time: '08:00' }, now, HOURS), true)     // exactly 24 hours: still allowed
  assert.equal(canRequestChange({ date: '2026-10-20', time: '07:59' }, now, HOURS), false)    // 23 h 59 min
  assert.equal(canRequestChange({ date: '2026-10-21', time: '09:00:00' }, now, HOURS), true)  // 49 hours
  assert.equal(canRequestChange({ date: '2026-10-19', time: '07:00' }, now, HOURS), false)    // already started
  assert.equal(minutesUntil({ date: '2026-10-19', time: '07:00' }, now), -60)
  // winter time (UTC+1): 06:00Z is 07:00 in Madrid
  const winter = new Date(Date.UTC(2026, 11, 19, 6, 0))
  assert.equal(canRequestChange({ date: '2026-12-20', time: '07:00' }, winter, HOURS), true)
  assert.equal(canRequestChange({ date: '2026-12-20', time: '06:59' }, winter, HOURS), false)
  // the day the clocks go BACK (Sunday 25 October 2026): 11:00 on Sunday is 24 real hours after 12:00 on Saturday
  const saturday = new Date(Date.UTC(2026, 9, 24, 10, 0))                    // 12:00 in Madrid
  assert.equal(minutesUntil({ date: '2026-10-25', time: '11:00' }, saturday), 24 * 60)
  assert.equal(canRequestChange({ date: '2026-10-25', time: '11:00' }, saturday, HOURS), true)
  assert.equal(canRequestChange({ date: '2026-10-25', time: '10:59' }, saturday, HOURS), false)
  // the day the clocks go FORWARD (Sunday 29 March 2026): 13:00 on Sunday is 24 real hours after 12:00 on Saturday
  const saturdaySpring = new Date(Date.UTC(2026, 2, 28, 11, 0))              // 12:00 in Madrid (still winter time)
  assert.equal(minutesUntil({ date: '2026-03-29', time: '13:00' }, saturdaySpring), 24 * 60)
  assert.equal(canRequestChange({ date: '2026-03-29', time: '12:59' }, saturdaySpring, HOURS), false)
  // change the number and the answer follows, with nothing else changed
  assert.equal(canRequestChange({ date: '2026-10-19', time: '20:00' }, now, 12), true)        // 12 hours
  assert.equal(canRequestChange({ date: '2026-10-19', time: '19:59' }, now, 12), false)
  // no number yet (the page is still loading it): the button stays on while the session has not started; the server decides
  assert.equal(canRequestChange({ date: '2026-10-19', time: '16:00' }, now), true)
  assert.equal(canRequestChange({ date: '2026-10-19', time: '07:00' }, now), false)
})
