const nodemailer = require('nodemailer');
const dbAdapter = require('./db');

const DEFAULT_SENDER = 'tenissfc@gmail.com';
const PROFESSOR_EMAILS = ['jarnocefarelli@gmail.com', 'leonardoalbertoli@gmail.com'];

/**
 * Envío vía Google Apps Script Webhook (HTTPS Puerto 443).
 * Solución recomendada para Render Free ya que Render bloquea los puertos SMTP (465/587),
 * pero permite todo el tráfico HTTPS saliente hacia los servidores de Google.
 */
async function sendViaGoogleScript(url, mailData) {
  const cleanUrl = url.trim();
  const response = await fetch(cleanUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: mailData.to,
      cc: Array.isArray(mailData.cc) ? mailData.cc.join(',') : (mailData.cc || ''),
      subject: mailData.subject,
      text: mailData.text,
      html: mailData.html,
      senderName: 'Tenis Sportivo FC Álvarez'
    }),
    redirect: 'follow'
  });

  const rawText = await response.text();
  try {
    const data = JSON.parse(rawText);
    if (data.status === 'ok' || data.status === 'Success') {
      return { success: true, via: 'google_script' };
    }
    throw new Error(data.error || data.message || 'Error en Apps Script');
  } catch (err) {
    if (rawText.includes('ok') || rawText.includes('success') || response.status === 200) {
      return { success: true, via: 'google_script' };
    }
    throw new Error(`Google Apps Script: ${rawText.substring(0, 120)}`);
  }
}

/**
 * Envío alternativo vía Resend API (HTTPS Puerto 443).
 */
async function sendViaResend(apiKey, mailData) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Tenis Sportivo FC <onboarding@resend.dev>',
      to: [mailData.to],
      cc: mailData.cc,
      subject: mailData.subject,
      text: mailData.text,
      html: mailData.html
    })
  });
  const data = await response.json();
  if (response.ok) return { success: true, messageId: data.id, via: 'resend' };
  throw new Error(data.message || JSON.stringify(data));
}

/**
 * Transportador SMTP para entornos donde los puertos no estén bloqueados (ej. planes pagos o local).
 */
function createSmtpTransporter(user, pass, port = 465) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: port,
    secure: port === 465,
    family: 4,
    auth: {
      user: user.trim(),
      pass: pass.trim().replace(/\s+/g, '')
    },
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    },
    connectionTimeout: 8000,
    greetingTimeout: 6000,
    socketTimeout: 10000
  });
}

async function sendMailWithFallback(mailOptions, user, pass) {
  const ports = [465, 587];
  let lastError = null;

  for (const port of ports) {
    try {
      const transporter = createSmtpTransporter(user, pass, port);
      const info = await transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId, port, via: 'smtp' };
    } catch (err) {
      console.warn(`[MAILER SMTP] Falló puerto ${port}: ${err.message}`);
      lastError = err;
    }
  }

  throw lastError;
}

function formatPlayersHtml(players, titularName) {
  if (!Array.isArray(players) || players.length === 0) {
    return `<li><strong>1. ${titularName}</strong> (Titular)</li>`;
  }
  let html = `<li><strong>1. ${titularName}</strong> (Titular)</li>`;
  players.forEach((p, idx) => {
    html += `<li><strong>${idx + 2}. ${p.nombre}</strong> (${p.isSocio ? 'Socio SFC' : 'No Socio'})</li>`;
  });
  return html;
}

function formatPlayersText(players, titularName) {
  if (!Array.isArray(players) || players.length === 0) {
    return `  1. ${titularName} (Titular)`;
  }
  let txt = `  1. ${titularName} (Titular)\n`;
  players.forEach((p, idx) => {
    txt += `  ${idx + 2}. ${p.nombre} (${p.isSocio ? 'Socio SFC' : 'No Socio'})\n`;
  });
  return txt.trimEnd();
}

/**
 * Envía email de confirmación de reserva al titular y en copia a los profesores Jarno y Leonardo.
 */
async function sendBookingConfirmationEmail(booking, user, emailConfig = null) {
  const titularName = `${user.nombre} ${user.apellido}`;
  const senderEmail = (emailConfig && emailConfig.senderEmail) || DEFAULT_SENDER;
  const pass = (emailConfig && emailConfig.appPassword) || process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD || '';
  const scriptUrl = (emailConfig && emailConfig.googleScriptUrl) || process.env.GOOGLE_SCRIPT_URL || '';
  const resendKey = (emailConfig && emailConfig.resendApiKey) || process.env.RESEND_API_KEY || '';

  const profs = (emailConfig && emailConfig.profEmails && emailConfig.profEmails.length > 0)
    ? emailConfig.profEmails
    : PROFESSOR_EMAILS;

  // Destinatarios: titular en TO, profesores en CC
  const toEmail = user.mail;
  const ccEmails = profs.filter(p => p && p.toLowerCase() !== toEmail.toLowerCase());

  const subject = `🎾 Confirmación de Turno - ${booking.court} (${booking.slot}) - Sportivo FC Álvarez`;

  const textContent = `
Estimado/a ${titularName},

¡Tu turno de tenis en Sportivo Fútbol Club de Álvarez ha sido confirmado!

Detalles de la Reserva:
- Cancha: ${booking.court} (Polvo de Ladrillo)
- Fecha: ${booking.date}
- Turno: ${booking.slot}
- Modalidad: ${booking.modalidad === 'dobles' ? 'Dobles (4 jugadores)' : 'Singles (2 jugadores)'}
- Jugadores:
${formatPlayersText(booking.players, titularName)}

AVISO MUY IMPORTANTE:
"Si por alguna razón no vas a poder usar el turno, por favor cancelalo a tiempo desde la web para que otro socio pueda aprovecharlo y disfrutar de la cancha."

Copia enviada a los profesores Jarno Cefarelli y Leonardo Albertoli para la coordinación de canchas.

Consultas o administración: 3402 521352
Sportivo Fútbol Club de Álvarez
  `.trim();

  const htmlContent = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%); color: #ffffff; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px;">SPORTIVO FÚTBOL CLUB DE ÁLVAREZ</h1>
    <p style="margin: 6px 0 0 0; font-size: 14px; color: #93c5fd;">Subcomisión de Tenis • Sistema de Canchas</p>
  </div>

  <div style="padding: 24px;">
    <div style="background-color: #dcfce7; border-left: 4px solid #16a34a; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px;">
      <strong style="color: #166534; font-size: 15px;">✓ ¡Turno Confirmado con Éxito!</strong>
      <p style="margin: 4px 0 0 0; color: #15803d; font-size: 13px;">Hola <strong>${titularName}</strong>, tu cancha ya está agendada en el sistema.</p>
    </div>

    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
      <tbody>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; color: #64748b; width: 140px;"><strong>Cancha:</strong></td>
          <td style="padding: 10px 0; font-weight: bold; color: #0f172a;">${booking.court} (Polvo de Ladrillo)</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; color: #64748b;"><strong>Fecha:</strong></td>
          <td style="padding: 10px 0; font-weight: bold; color: #1e40af;">${booking.date}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; color: #64748b;"><strong>Horario:</strong></td>
          <td style="padding: 10px 0; font-weight: bold; color: #2563eb; font-size: 15px;">${booking.slot}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; color: #64748b;"><strong>Modalidad:</strong></td>
          <td style="padding: 10px 0;">${booking.modalidad === 'dobles' ? 'Dobles (4 jugadores)' : 'Singles (2 jugadores)'}</td>
        </tr>
      </tbody>
    </table>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 20px;">
      <strong style="color: #334155; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">👥 Jugadores Registrados:</strong>
      <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 14px; color: #1e293b; line-height: 1.6;">
        ${formatPlayersHtml(booking.players, titularName)}
      </ul>
    </div>

    <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; margin-bottom: 20px;">
      <strong style="color: #92400e; font-size: 13px;">⚠️ AVISO MUY IMPORTANTE:</strong>
      <p style="margin: 6px 0 0 0; font-size: 13px; color: #b45309; line-height: 1.5;">
        "Si por alguna razón no vas a poder usar el turno, por favor cancelalo con anticipación desde la web para que otro socio pueda aprovecharlo y disfrutar de la cancha."
      </p>
    </div>

    <p style="font-size: 12px; color: #64748b; margin-top: 15px; border-top: 1px dashed #cbd5e1; padding-top: 12px;">
      ℹ️ <em>Aviso automático: este turno se envía con copia informativa a los profesores Jarno Cefarelli y Leonardo Albertoli para el control de ocupación de las canchas del club.</em>
    </p>
  </div>

  <div style="background-color: #f1f5f9; padding: 16px 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">
    <strong>Sportivo Fútbol Club de Álvarez</strong> • San Martín y Urquiza, Álvarez, Santa Fe<br>
    Consultas y administración: <strong>3402 521352</strong>
  </div>
</div>
  `.trim();

  // 1. Guardar siempre en historial Supabase
  const logSummary = `Para: ${toEmail} | CC: ${ccEmails.join(', ')}\n\n${textContent}`;
  await dbAdapter.logSentEmail(toEmail, logSummary);

  const mailData = { to: toEmail, cc: ccEmails, subject, text: textContent, html: htmlContent };

  // 2. Método 1: Google Script Webhook (HTTPS Puerto 443 - 100% compatible con Render Free)
  if (scriptUrl) {
    try {
      const res = await sendViaGoogleScript(scriptUrl, mailData);
      console.log(`✅ [EMAIL ENVIADO VIA GOOGLE APPS SCRIPT] To: ${toEmail}, CC: ${ccEmails.join(', ')}`);
      return { success: true, via: 'google_script' };
    } catch (e) {
      console.warn(`⚠️ Error enviando por Google Script Webhook: ${e.message}`);
    }
  }

  // 3. Método 2: Resend API (HTTPS Puerto 443)
  if (resendKey) {
    try {
      const res = await sendViaResend(resendKey, mailData);
      console.log(`✅ [EMAIL ENVIADO VIA RESEND API] To: ${toEmail}, CC: ${ccEmails.join(', ')}`);
      return { success: true, via: 'resend' };
    } catch (e) {
      console.warn(`⚠️ Error enviando por Resend API: ${e.message}`);
    }
  }

  // 4. Método 3: SMTP Directo
  if (pass) {
    try {
      const res = await sendMailWithFallback({
        from: `"Tenis Sportivo FC Álvarez" <${senderEmail}>`,
        to: toEmail,
        cc: ccEmails,
        subject,
        text: textContent,
        html: htmlContent
      }, senderEmail, pass);
      console.log(`✅ [EMAIL ENVIADO VIA SMTP GMAIL] Puerto ${res.port} -> To: ${toEmail}, CC: ${ccEmails.join(', ')}`);
      return { success: true, via: 'smtp' };
    } catch (err) {
      console.warn(`⚠️ [ADVERTENCIA SMTP] No se pudo enviar por puertos SMTP (Render Free bloquea 465/587): ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  return { success: false, pendingConfig: true };
}

/**
 * Envía email de cancelación de reserva al titular y a los profesores.
 */
async function sendBookingCancellationEmail(booking, user, cancelledByName = null, emailConfig = null) {
  const titularName = `${user.nombre} ${user.apellido}`;
  const senderEmail = (emailConfig && emailConfig.senderEmail) || DEFAULT_SENDER;
  const pass = (emailConfig && emailConfig.appPassword) || process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD || '';
  const scriptUrl = (emailConfig && emailConfig.googleScriptUrl) || process.env.GOOGLE_SCRIPT_URL || '';
  const resendKey = (emailConfig && emailConfig.resendApiKey) || process.env.RESEND_API_KEY || '';

  const profs = (emailConfig && emailConfig.profEmails && emailConfig.profEmails.length > 0)
    ? emailConfig.profEmails
    : PROFESSOR_EMAILS;

  const toEmail = user.mail;
  const ccEmails = profs.filter(p => p && p.toLowerCase() !== toEmail.toLowerCase());

  const subject = `⚠️ Turno Cancelado (Cancha Libre) - ${booking.court} (${booking.slot}) - Sportivo FC Álvarez`;

  const textContent = `
Aviso de Cancelación de Reserva:

El turno correspondiente a:
- Cancha: ${booking.court}
- Fecha: ${booking.date}
- Horario: ${booking.slot}
- Titular original: ${titularName}

Ha sido CANCELADO${cancelledByName ? ` por: ${cancelledByName}` : ''}.
La cancha ha quedado nuevamente LIBRE para que otro socio pueda reservarla.

Sportivo Fútbol Club de Álvarez
  `.trim();

  const htmlContent = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%); color: #ffffff; padding: 20px; text-align: center;">
    <h1 style="margin: 0; font-size: 18px; font-weight: 800;">SPORTIVO FÚTBOL CLUB DE ÁLVAREZ</h1>
    <p style="margin: 4px 0 0 0; font-size: 13px; color: #fecaca;">Aviso de Cancelación de Turno</p>
  </div>
  <div style="padding: 24px;">
    <div style="background-color: #fee2e2; border-left: 4px solid #dc2626; padding: 12px; border-radius: 6px; margin-bottom: 16px;">
      <strong style="color: #991b1b;">Turno Cancelado - Cancha Libre</strong>
      <p style="margin: 4px 0 0 0; color: #7f1d1d; font-size: 13px;">El siguiente turno ha sido cancelado y vuelve a estar disponible para el club:</p>
    </div>
    <ul style="font-size: 14px; line-height: 1.8; color: #334155;">
      <li><strong>Cancha:</strong> ${booking.court}</li>
      <li><strong>Fecha:</strong> ${booking.date}</li>
      <li><strong>Turno:</strong> ${booking.slot}</li>
      <li><strong>Titular:</strong> ${titularName}</li>
      ${cancelledByName ? `<li><strong>Acción realizada por:</strong> ${cancelledByName}</li>` : ''}
    </ul>
  </div>
</div>
  `.trim();

  const logSummary = `[CANCELACIÓN] Para: ${toEmail} | CC: ${ccEmails.join(', ')}\n\n${textContent}`;
  await dbAdapter.logSentEmail(toEmail, logSummary);

  const mailData = { to: toEmail, cc: ccEmails, subject, text: textContent, html: htmlContent };

  if (scriptUrl) {
    try {
      await sendViaGoogleScript(scriptUrl, mailData);
      return;
    } catch (e) {}
  }

  if (resendKey) {
    try {
      await sendViaResend(resendKey, mailData);
      return;
    } catch (e) {}
  }

  if (pass) {
    try {
      await sendMailWithFallback({
        from: `"Tenis Sportivo FC Álvarez" <${senderEmail}>`,
        to: toEmail,
        cc: ccEmails,
        subject,
        text: textContent,
        html: htmlContent
      }, senderEmail, pass);
    } catch (e) {}
  }
}

/**
 * Prueba la conexión enviando un email de test.
 */
async function testEmailConnection(emailConfig) {
  const scriptUrl = (emailConfig && emailConfig.googleScriptUrl) || process.env.GOOGLE_SCRIPT_URL || '';
  const resendKey = (emailConfig && emailConfig.resendApiKey) || process.env.RESEND_API_KEY || '';
  const pass = (emailConfig && emailConfig.appPassword) || process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD || '';
  const user = (emailConfig && emailConfig.senderEmail) || process.env.EMAIL_USER || DEFAULT_SENDER;

  const testMailData = {
    to: user,
    cc: '',
    subject: '🎾 Prueba de Conexión de Correo - Sportivo FC Álvarez',
    text: '¡Conexión verificada exitosamente! El sistema de reservas de tenis ya puede enviar notificaciones a los socios y a los profesores Jarno Cefarelli y Leonardo Albertoli.',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e40af; margin-top: 0;">🎾 ¡Conexión con Gmail Exitosa!</h2>
        <p>El sistema de reservas de tenis de <strong>Sportivo Fútbol Club de Álvarez</strong> está listo para enviar notificaciones automáticas desde <strong>${user}</strong>.</p>
        <p style="color: #64748b; font-size: 13px;">Verificado a las ${new Date().toLocaleTimeString('es-AR')}.</p>
      </div>
    `
  };

  // 1. Probar Google Script Webhook (Recomendado Render Free - Puerto 443)
  if (scriptUrl) {
    try {
      console.log('[TEST EMAIL] Probando envío por Google Apps Script Webhook (Puerto 443 HTTPS)...');
      await sendViaGoogleScript(scriptUrl, testMailData);
      return {
        ok: true,
        message: `¡Prueba exitosa! Correo de verificación enviado desde ${user} a través del Webhook de Google (HTTPS Puerto 443 sin bloqueos).`
      };
    } catch (err) {
      return { ok: false, error: `Error en Webhook de Google: ${err.message}` };
    }
  }

  // 2. Probar Resend API
  if (resendKey) {
    try {
      await sendViaResend(resendKey, testMailData);
      return {
        ok: true,
        message: `¡Prueba exitosa vía Resend API! Correo enviado a ${user}.`
      };
    } catch (err) {
      return { ok: false, error: `Error en Resend API: ${err.message}` };
    }
  }

  // 3. Probar SMTP Directo (si no configuró webhook)
  if (pass) {
    const ports = [465, 587];
    let lastError = null;

    for (const port of ports) {
      try {
        console.log(`[TEST EMAIL SMTP] Probando puerto ${port}...`);
        const transporter = createSmtpTransporter(user, pass, port);
        await transporter.verify();
        const info = await transporter.sendMail({
          from: `"Tenis Sportivo FC Álvarez" <${user}>`,
          to: user,
          subject: testMailData.subject,
          text: testMailData.text,
          html: testMailData.html
        });
        return {
          ok: true,
          message: `¡Prueba exitosa vía SMTP directo! Correo enviado a ${user} (Puerto ${port}).`
        };
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError && (lastError.code === 'ETIMEDOUT' || lastError.message.includes('timeout'))) {
      return {
        ok: false,
        isSmtpBlocked: true,
        error: 'Render bloquea los puertos SMTP salientes (465/587) en su plan gratuito (Firewall ETIMEDOUT). Para enviar correos desde tenissfc@gmail.com sin costo, pegá la URL de Webhook de Google Apps Script (que opera por HTTPS Puerto 443).'
      };
    }

    return { ok: false, error: lastError ? lastError.message : 'Error desconocido de conexión.' };
  }

  return {
    ok: false,
    error: 'Falta configurar un método de envío: pegá la URL del Webhook de Google Apps Script o una clave de API.'
  };
}

module.exports = {
  DEFAULT_SENDER,
  PROFESSOR_EMAILS,
  sendBookingConfirmationEmail,
  sendBookingCancellationEmail,
  testEmailConnection
};
