// Google Apps Script: the ThundBalance backend posts here and this script sends
// the e-mail with GmailApp (from the account that owns the script). See
// docs/TRIAL_EMAIL_SETUP.md. SECRET must be identical to TRIAL_EMAIL_WEBHOOK_SECRET in Render.
//
// Two kinds of request are understood:
//   1. New format: { secret, to, cc, subject, html, text, replyTo, name, attachments: [{name, type, data(base64)}] }
//   2. Old format: { secret, to, trial: {...} }  (plain-text trial notice, kept so an old
//      deployment of the backend keeps working)
const SECRET = 'PUT-THE-SAME-SECRET-AS-IN-RENDER-HERE';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) {
      console.error('Clave incorrecta: no coincide con SECRET');
      return reply({ ok: false, error: 'unauthorized' });
    }
    if (data.subject && (data.html || data.text)) {
      return sendMessage(data);
    }
    return sendLegacyTrialNotice(data);
  } catch (err) {
    console.error(String(err));
    return reply({ ok: false, error: String(err) });
  }
}

function sendMessage(data) {
  const options = {
    name: data.name || 'ThundBalance',
    replyTo: data.replyTo || 'info@thundbalance.com'
  };
  if (data.html) options.htmlBody = data.html;
  if (data.cc) options.cc = data.cc;
  if (data.attachments && data.attachments.length) {
    options.attachments = data.attachments.map(function (file) {
      return Utilities.newBlob(Utilities.base64Decode(file.data), file.type || 'application/octet-stream', file.name);
    });
  }
  console.log('Enviando "' + data.subject + '" (' + (data.attachments ? data.attachments.length : 0) + ' adjuntos)');
  GmailApp.sendEmail(data.to, data.subject, data.text || '', options);
  return reply({ ok: true });
}

function sendLegacyTrialNotice(data) {
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
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
