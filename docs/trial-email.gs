// Google Apps Script: receives a trial-session request from the ThundBalance
// backend and e-mails it to the studio. See docs/TRIAL_EMAIL_SETUP.md.
const SECRET = 'PUT-THE-SAME-SECRET-AS-IN-RENDER-HERE';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return reply({ ok: false, error: 'unauthorized' });

    const t = data.trial || {};
    const rows = [
      ['Nombre', t.full_name],
      ['Email', t.email],
      ['Teléfono', t.phone],
      ['Fecha de nacimiento', t.birth_date ? t.birth_date + (t.age != null ? ' (' + t.age + ' años)' : '') : (t.age != null ? t.age + ' años' : '—')],
      ['Objetivos', t.goal],
      ['Experiencia', t.experience],
      ['Fecha solicitada', t.session_date],
      ['Hora solicitada', t.session_time],
    ];
    const text = 'Nueva solicitud de sesión de prueba\n\n' + rows.map(r => r[0] + ': ' + (r[1] || '—')).join('\n') +
      '\n\nGestiónala desde el panel de administración.';
    const html = '<h2>Nueva solicitud de sesión de prueba</h2><table cellpadding="6">' +
      rows.map(r => '<tr><td><b>' + esc(r[0]) + '</b></td><td>' + esc(r[1] || '—') + '</td></tr>').join('') +
      '</table><p>Gestiónala desde el panel de administración.</p>';

    MailApp.sendEmail({
      to: data.to,
      replyTo: t.email,
      subject: 'Nueva sesión de prueba: ' + (t.full_name || '') + ' — ' + (t.session_date || '') + ' ' + (t.session_time || ''),
      body: text,
      htmlBody: html,
      name: 'ThundBalance Web',
    });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
