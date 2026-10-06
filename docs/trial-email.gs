// Google Apps Script: receives a trial-session request from the ThundBalance
// backend and e-mails it to the studio. See docs/TRIAL_EMAIL_SETUP.md.
// SECRET must be identical to TRIAL_EMAIL_WEBHOOK_SECRET in Render.
const SECRET = 'PUT-THE-SAME-SECRET-AS-IN-RENDER-HERE';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) {
      console.error('Clave incorrecta: no coincide con SECRET');
      return reply({ ok: false, error: 'unauthorized' });
    }
    const t = data.trial || {};
    console.log('Enviando aviso a ' + data.to + ' para ' + t.full_name);
    const body =
      'Nueva solicitud de sesión de prueba\n\n' +
      'Nombre: ' + (t.full_name || '—') + '\n' +
      'Email: ' + (t.email || '—') + '\n' +
      'Teléfono: ' + (t.phone || '—') + '\n' +
      'Fecha de nacimiento: ' + (t.birth_date || '—') + (t.age != null ? ' (' + t.age + ' años)' : '') + '\n' +
      'Objetivos: ' + (t.goal || '—') + '\n' +
      'Experiencia: ' + (t.experience || '—') + '\n' +
      'Fecha solicitada: ' + (t.session_date || '—') + '\n' +
      'Hora solicitada: ' + (t.session_time || '—') + '\n\n' +
      'Gestiónala desde el panel de administración.';
    GmailApp.sendEmail(
      data.to,
      'Nueva sesión de prueba: ' + (t.full_name || '') + ' — ' + (t.session_date || '') + ' ' + (t.session_time || ''),
      body,
      { replyTo: t.email, name: 'ThundBalance Web' }
    );
    return reply({ ok: true });
  } catch (err) {
    console.error(String(err));
    return reply({ ok: false, error: String(err) });
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
