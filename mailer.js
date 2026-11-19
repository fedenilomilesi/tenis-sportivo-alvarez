const nodemailer = require('nodemailer');
const dbAdapter = require('./db');

const DEFAULT_SENDER = 'tenissfc@gmail.com';
const PROFESSOR_EMAILS = ['jarnocefarelli@gmail.com', 'leonardoalbertoli@gmail.com'];

function getTransporter(emailConfig) {
  const pass = (emailConfig && emailConfig.appPassword) || process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD || '';
  const user = (emailConfig && emailConfig.senderEmail) || process.env.EMAIL_USER || DEFAULT_SENDER;

  if (!pass) return null;

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: user.trim(),
      pass: pass.trim().replace(/\s+/g, '') // Quita espacios si pegaron los 16 caracteres separados
    }
  });
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
  const profs = (emailConfig && emailConfig.profEmails && emailConfig.profEmails.length > 0)
    ? emailConfig.profEmails
    : PROFESSOR_EMAILS;

  // Destinatarios: el titular en TO, y los profesores en CC
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

  // 1. Guardar siempre en el historial de Supabase
  const logSummary = `Para: ${toEmail} | CC: ${ccEmails.join(', ')}\n\n${textContent}`;
  await dbAdapter.logSentEmail(toEmail, logSummary);

  // 2. Intentar envío real por SMTP Gmail
  const transporter = getTransporter(emailConfig);
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: `"Tenis Sportivo FC Álvarez" <${senderEmail}>`,
        to: toEmail,
        cc: ccEmails,
        subject,
        text: textContent,
        html: htmlContent
      });
      console.log(`✅ [EMAIL REAL ENVIADO VIA GMAIL] Id: ${info.messageId} -> To: ${toEmail}, CC: ${ccEmails.join(', ')}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.warn(`⚠️ [ADVERTENCIA GMAIL] No se pudo enviar por SMTP (${err.message}). El turno quedó registrado correctamente y el correo guardado en el historial.`);
      return { success: false, error: err.message };
    }
  } else {
    console.log(`ℹ️ [MODO REGISTRO] Correo registrado en base de datos. Para activar el envío real por Gmail ingresá la contraseña de aplicación de ${senderEmail} en Parametrización.`);
    return { success: false, pendingConfig: true };
  }
}

/**
 * Envía email de cancelación de reserva al titular y a los profesores.
 */
async function sendBookingCancellationEmail(booking, user, cancelledByName = null, emailConfig = null) {
  const titularName = `${user.nombre} ${user.apellido}`;
  const senderEmail = (emailConfig && emailConfig.senderEmail) || DEFAULT_SENDER;
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

  const transporter = getTransporter(emailConfig);
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"Tenis Sportivo FC Álvarez" <${senderEmail}>`,
        to: toEmail,
        cc: ccEmails,
        subject,
        text: textContent,
        html: htmlContent
      });
      console.log(`✅ [CANCELACIÓN ENVIADA] To: ${toEmail}, CC: ${ccEmails.join(', ')}`);
    } catch (e) {
      console.warn('⚠️ Error enviando mail de cancelación:', e.message);
    }
  }
}

/**
 * Prueba la conexión enviando un email de test a la propia cuenta tenissfc@gmail.com
 */
async function testEmailConnection(emailConfig) {
  const transporter = getTransporter(emailConfig);
  if (!transporter) {
    return { ok: false, error: 'Falta configurar la contraseña de aplicación de Gmail (16 letras).' };
  }
  const user = (emailConfig && emailConfig.senderEmail) || DEFAULT_SENDER;
  try {
    await transporter.verify();
    // Enviar correo de prueba
    const info = await transporter.sendMail({
      from: `"Tenis Sportivo FC Álvarez" <${user}>`,
      to: user,
      subject: '🎾 Prueba de Conexión de Correo - Sportivo FC Álvarez',
      text: '¡Conexión verificada exitosamente! El sistema de reservas de tenis ya puede enviar notificaciones a los socios y a los profesores Jarno Cefarelli y Leonardo Albertoli.',
      html: '<h2 style="color:#1e40af;">🎾 ¡Conexión con Gmail Exitosa!</h2><p>El sistema de reservas de tenis de <strong>Sportivo Fútbol Club de Álvarez</strong> está listo para enviar notificaciones automáticas al titular y en copia a los profesores.</p>'
    });
    return { ok: true, message: `Correo de prueba enviado con éxito a ${user} (ID: ${info.messageId})` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  DEFAULT_SENDER,
  PROFESSOR_EMAILS,
  sendBookingConfirmationEmail,
  sendBookingCancellationEmail,
  testEmailConnection
};
