const http = require('http');
const fs = require('fs');
const path = require('path');
const { cleanDni } = require('./sociosManager');
const dbAdapter = require('./db');
const mailer = require('./mailer');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const SLOTS = [
  '14:00 a 15:30 hs',
  '15:30 a 17:00 hs',
  '17:00 a 18:30 hs',
  '18:30 a 20:00 hs',
  '20:00 a 21:30 hs',
  '21:30 a 23:00 hs'
];

const COURTS = ['Cancha 1', 'Cancha 2'];

const PROF_DNIS = ['47039935', '25410483'];
const ADMIN_DNIS = ['31610066', '00000000'];

const DEFAULT_PRICES = dbAdapter.DEFAULT_PRICES;
const DEFAULT_BANK_INFO = dbAdapter.DEFAULT_BANK_INFO;

function isAdminUser(dni) {
  const clean = String(dni || '').replace(/\D/g, '');
  return ADMIN_DNIS.includes(clean);
}

function isProfessorUser(nombre, apellido, dni) {
  const clean = String(dni || '').replace(/\D/g, '');
  if (PROF_DNIS.includes(clean)) return true;
  const full = `${nombre || ''} ${apellido || ''}`.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (
    (full.includes('jarno') && full.includes('cefarelli')) ||
    (full.includes('leonardo') && full.includes('albertoli'))
  );
}

// Obtiene fecha y hora precisa en zona horaria Argentina (GMT-3)
function getArgentinaTime(dateInput = new Date()) {
  const d = new Date(dateInput);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);

  const m = {};
  parts.forEach(p => m[p.type] = p.value);
  return {
    year: parseInt(m.year, 10),
    month: parseInt(m.month, 10),
    day: parseInt(m.day, 10),
    hour: parseInt(m.hour, 10),
    minute: parseInt(m.minute, 10),
    second: parseInt(m.second, 10)
  };
}

// Retorna timestamp UTC exacto para una fecha y hora de Argentina (GMT-3)
function getArgTimestamp(year, month, day, hour = 0, minute = 0, second = 0) {
  return Date.UTC(year, month - 1, day, hour + 3, minute, second, 0);
}

function getSlotStartTimestamp(dateStr, slotStr) {
  const match = slotStr.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const [y, m, d] = dateStr.split('-').map(Number);
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  return getArgTimestamp(y, m, d, hour, minute, 0);
}

function checkBookingWindow(targetDateStr, role, nowInput) {
  const [ty, tm, td] = targetDateStr.split('-').map(Number);
  const argNow = getArgentinaTime(nowInput);
  const nowTs = getArgTimestamp(argNow.year, argNow.month, argNow.day, argNow.hour, argNow.minute, argNow.second);

  // Inicio del día de hoy en Argentina
  const todayStartTs = getArgTimestamp(argNow.year, argNow.month, argNow.day, 0, 0, 0);
  const targetDayStartTs = getArgTimestamp(ty, tm, td, 0, 0, 0);

  if (targetDayStartTs < todayStartTs) {
    return {
      allowed: false,
      reason: 'No se pueden reservar turnos en fechas pasadas.'
    };
  }

  // Apertura: día anterior a las 20:00 (profesor) o 21:00 (socio)
  const openHour = role === 'profesor' ? 20 : 21;
  // Calculamos el día anterior en Argentina
  const prevDayDate = new Date(ty, tm - 1, td - 1);
  const py = prevDayDate.getFullYear();
  const pm = prevDayDate.getMonth() + 1;
  const pd = prevDayDate.getDate();

  const openTimeTs = getArgTimestamp(py, pm, pd, openHour, 0, 0);
  const closeTimeTs = getArgTimestamp(ty, tm, td, 23, 59, 59);

  if (nowTs < openTimeTs) {
    const prevDayStr = `${py}-${String(pm).padStart(2, '0')}-${String(pd).padStart(2, '0')}`;
    return {
      allowed: false,
      reason: role === 'profesor'
        ? `La reserva prioritaria para profesores del día ${targetDateStr} se habilita el ${prevDayStr} a las 20:00 hs (1 hora antes que al resto).`
        : `La reserva para el día ${targetDateStr} se habilita el día anterior (${prevDayStr}) a las 21:00 hs. No se pueden reservar turnos hacia adelante.`
    };
  }

  if (nowTs > closeTimeTs) {
    return {
      allowed: false,
      reason: 'El día seleccionado ya ha finalizado.'
    };
  }

  return { allowed: true };
}

// Email Notification to User & Professors (Jarno & Leonardo)
async function sendConfirmationEmailAsync(booking, user) {
  const settings = await dbAdapter.getSettings();
  return await mailer.sendBookingConfirmationEmail(booking, user, settings.emailConfig);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // GET /api/players-list (Lista unificada de socios y registrados para los desplegables de jugadores)
  if (pathname === '/api/players-list' && req.method === 'GET') {
    try {
      const [users, padron] = await Promise.all([
        dbAdapter.getUsers(),
        dbAdapter.getSociosPadron()
      ]);
      const map = new Map();

      // 1. Del padrón oficial
      padron.forEach(s => {
        const clean = cleanDni(s.dni);
        map.set(clean, {
          dni: clean,
          nombre: s.nombre,
          isSocio: true,
          source: 'padron'
        });
      });

      // 2. De los usuarios registrados en el sistema
      users.forEach(u => {
        const clean = cleanDni(u.dni);
        const isSocio = u.role === 'profesor' || u.role === 'admin' || u.memberType === 'socio' || map.has(clean);
        map.set(clean, {
          dni: clean,
          nombre: `${u.nombre} ${u.apellido}`,
          isSocio,
          source: 'user'
        });
      });

      const list = Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
      return sendJson(res, 200, { players: list });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error obteniendo lista de jugadores.' });
    }
  }

  // GET /api/config
  if (pathname === '/api/config' && req.method === 'GET') {
    try {
      const [settings, users] = await Promise.all([
        dbAdapter.getSettings(),
        dbAdapter.getUsers()
      ]);
      return sendJson(res, 200, {
        slots: SLOTS,
        courts: COURTS,
        professors: users.filter(u => u.role === 'profesor'),
        pricing: settings.pricing || DEFAULT_PRICES,
        bankInfo: settings.bankInfo || DEFAULT_BANK_INFO
      });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error cargando configuración.' });
    }
  }

  // GET & POST /api/admin/settings (Precios por no socios y datos bancarios)
  if (pathname === '/api/admin/settings' && req.method === 'GET') {
    try {
      const settings = await dbAdapter.getSettings();
      return sendJson(res, 200, {
        pricing: settings.pricing || DEFAULT_PRICES,
        bankInfo: settings.bankInfo || DEFAULT_BANK_INFO,
        emailConfig: settings.emailConfig || dbAdapter.DEFAULT_EMAIL_CONFIG
      });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error obteniendo configuración admin.' });
    }
  }

  if (pathname === '/api/admin/settings' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const current = await dbAdapter.getSettings();
      let newPricing = current.pricing || { ...DEFAULT_PRICES };
      let newBankInfo = current.bankInfo || { ...DEFAULT_BANK_INFO };
      let newEmailConfig = current.emailConfig || { ...dbAdapter.DEFAULT_EMAIL_CONFIG };

      if (body.pricing) {
        newPricing = {
          price1: Number(body.pricing.price1) || DEFAULT_PRICES.price1,
          price2: Number(body.pricing.price2) || DEFAULT_PRICES.price2,
          price3: Number(body.pricing.price3) || DEFAULT_PRICES.price3,
          price4: Number(body.pricing.price4) || DEFAULT_PRICES.price4
        };
      }
      if (body.bankInfo) {
        newBankInfo = {
          banco: (body.bankInfo.banco || '').trim(),
          titular: (body.bankInfo.titular || '').trim(),
          cuit: (body.bankInfo.cuit || '').trim(),
          cbu: (body.bankInfo.cbu || '').trim(),
          alias: (body.bankInfo.alias || '').trim(),
          nota: (body.bankInfo.nota || '').trim()
        };
      }
      if (body.emailConfig) {
        newEmailConfig = {
          senderEmail: (body.emailConfig.senderEmail || 'tenissfc@gmail.com').trim(),
          appPassword: (body.emailConfig.appPassword !== undefined ? body.emailConfig.appPassword : newEmailConfig.appPassword).trim(),
          profEmails: Array.isArray(body.emailConfig.profEmails) ? body.emailConfig.profEmails : newEmailConfig.profEmails,
          enabled: body.emailConfig.enabled !== false
        };
      }
      await dbAdapter.saveSettings(newPricing, newBankInfo, newEmailConfig);
      return sendJson(res, 200, {
        ok: true,
        message: 'Configuración de precios, banco y correos actualizada con éxito.',
        pricing: newPricing,
        bankInfo: newBankInfo,
        emailConfig: newEmailConfig
      });
    } catch (e) {
      return sendJson(res, 400, { error: 'Error guardando configuración.' });
    }
  }

  // POST /api/admin/test-email (Prueba de envío real con tenissfc@gmail.com)
  if (pathname === '/api/admin/test-email' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const settings = await dbAdapter.getSettings();
      const cfg = body.emailConfig || settings.emailConfig;
      const result = await mailer.testEmailConnection(cfg);
      if (result.ok) {
        return sendJson(res, 200, result);
      } else {
        return sendJson(res, 400, result);
      }
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  // POST /api/users/register
  if (pathname === '/api/users/register' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const nombre = (body.nombre || '').trim();
      const apellido = (body.apellido || '').trim();
      const dni = String(body.dni || '').trim().replace(/\D/g, '');
      const celular = String(body.celular || '').trim();
      const mail = (body.mail || '').trim().toLowerCase();

      if (!nombre || !apellido || !dni || !celular || !mail) {
        return sendJson(res, 400, { error: 'Todos los campos (Nombre, Apellido, DNI, Celular y Mail) son obligatorios.' });
      }

      // Validación estricta de unicidad 1 DNI <-> 1 solo Mail en Supabase
      const [userByDni, userByMail, padron] = await Promise.all([
        dbAdapter.findUserByDni(dni),
        dbAdapter.findUserByMail(mail),
        dbAdapter.getSociosPadron()
      ]);

      // Si el DNI ya está registrado con otro mail diferente, rechazar
      if (userByDni && userByDni.mail && userByDni.mail.toLowerCase() !== mail) {
        return sendJson(res, 409, {
          error: `El DNI ${dni} ya se encuentra registrado con el correo: ${userByDni.mail}. Para ingresar usá ese correo o comunicate con el club.`
        });
      }

      // Si el Mail ya está registrado con otro DNI diferente, rechazar
      if (userByMail && userByMail.dni && userByMail.dni !== dni) {
        return sendJson(res, 409, {
          error: `El correo ${mail} ya está asociado al DNI ${userByMail.dni}. Cada documento solo puede tener 1 único correo electrónico.`
        });
      }

      let user = userByDni || userByMail;
      const isAdmin = isAdminUser(dni) || (user && user.role === 'admin');
      const isProf = !isAdmin && (isProfessorUser(nombre, apellido, dni) || (user && user.role === 'profesor'));

      // Cruce automático con el padrón oficial de socios de tenis por DNI
      const isPadronSocio = padron.some(s => cleanDni(s.dni) === dni);
      const isRegisteredSocio = isAdmin || isProf || isPadronSocio;
      const memberType = isRegisteredSocio ? 'socio' : 'no_socio';

      if (user) {
        user.nombre = nombre;
        user.apellido = apellido;
        user.dni = dni;
        user.celular = celular;
        user.mail = mail;
        user.memberType = memberType;
        if (isAdmin) user.role = 'admin';
        else if (isProf) user.role = 'profesor';
      } else {
        user = {
          id: 'usr-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          nombre,
          apellido,
          dni,
          celular,
          mail,
          memberType,
          role: isAdmin ? 'admin' : isProf ? 'profesor' : 'socio'
        };
      }

      await dbAdapter.saveOrUpdateUser(user);
      return sendJson(res, 200, { user });
    } catch (e) {
      return sendJson(res, 400, { error: 'Formato de solicitud inválido.' });
    }
  }

  // POST /api/users/login (login with mail or dni)
  if (pathname === '/api/users/login' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const mail = (body.mail || '').trim().toLowerCase();
      const dni = String(body.dni || '').trim().replace(/\D/g, '');
      const userId = body.userId;

      let user = null;
      if (userId) user = await dbAdapter.findUserById(userId);
      if (!user && mail) user = await dbAdapter.findUserByMail(mail);
      if (!user && dni) user = await dbAdapter.findUserByDni(dni);

      if (!user) {
        return sendJson(res, 404, { error: 'No se encontró una cuenta con ese correo electrónico o DNI. Por favor completá el registro inicial una sola vez.' });
      }

      // Re-verificar si es admin o profe por DNI al loguearse
      const userCleanDni = cleanDni(user.dni);
      let roleUpdated = false;
      if (isAdminUser(userCleanDni)) {
        if (user.role !== 'admin' || user.memberType !== 'socio') {
          user.role = 'admin';
          user.memberType = 'socio';
          roleUpdated = true;
        }
      } else if (PROF_DNIS.includes(userCleanDni) || isProfessorUser(user.nombre, user.apellido, user.dni)) {
        if (user.role !== 'profesor' || user.memberType !== 'socio') {
          user.role = 'profesor';
          user.memberType = 'socio';
          roleUpdated = true;
        }
      }
      if (roleUpdated) {
        await dbAdapter.saveOrUpdateUser(user);
      }

      return sendJson(res, 200, { user });
    } catch (e) {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  // PUT & POST /api/users/:id (Admin & Profesor edit registered user)
  if ((pathname.startsWith('/api/users/') && req.method === 'PUT') || 
      (pathname.startsWith('/api/users/') && pathname.endsWith('/update') && req.method === 'POST')) {
    try {
      const parts = pathname.replace('/update', '').split('/');
      const userId = parts[3];
      const body = await parseBody(req);

      if (!userId) {
        return sendJson(res, 400, { error: 'ID de usuario no especificado.' });
      }

      const existingUser = await dbAdapter.findUserById(userId);
      if (!existingUser) {
        return sendJson(res, 404, { error: 'Usuario no encontrado.' });
      }

      const nombre = (body.nombre !== undefined ? body.nombre : existingUser.nombre).trim();
      const apellido = (body.apellido !== undefined ? body.apellido : existingUser.apellido).trim();
      const dni = body.dni ? cleanDni(body.dni) : existingUser.dni;
      const celular = (body.celular !== undefined ? body.celular : existingUser.celular).trim();
      const mail = (body.mail !== undefined ? body.mail : existingUser.mail).trim().toLowerCase();
      const memberType = body.memberType || existingUser.memberType || 'socio';
      const role = body.role || existingUser.role || 'socio';

      if (!nombre || !apellido || !dni || !mail) {
        return sendJson(res, 400, { error: 'Nombre, Apellido, DNI y Correo Electrónico son obligatorios.' });
      }

      // Validar unicidad de DNI con otros usuarios
      const userWithDni = await dbAdapter.findUserByDni(dni);
      if (userWithDni && userWithDni.id !== userId) {
        return sendJson(res, 409, { error: `El DNI ${dni} ya está registrado para otro usuario (${userWithDni.nombre} ${userWithDni.apellido}).` });
      }

      // Validar unicidad de Mail con otros usuarios
      const userWithMail = await dbAdapter.findUserByMail(mail);
      if (userWithMail && userWithMail.id !== userId) {
        return sendJson(res, 409, { error: `El correo ${mail} ya está registrado para otro usuario (${userWithMail.nombre} ${userWithMail.apellido}).` });
      }

      const updatedUser = {
        ...existingUser,
        nombre,
        apellido,
        dni,
        celular,
        mail,
        memberType,
        role
      };

      await dbAdapter.saveOrUpdateUser(updatedUser);

      // Si se definió como socio, sincronizar con el padrón oficial
      if (memberType === 'socio') {
        await dbAdapter.addOrUpdateSocio({
          dni,
          nombre: `${nombre} ${apellido}`,
          categoria: role === 'profesor' ? 'profesor' : 'socio'
        });
      }

      return sendJson(res, 200, {
        ok: true,
        user: updatedUser,
        message: `Usuario ${nombre} ${apellido} actualizado con éxito.`
      });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error al actualizar usuario.' });
    }
  }

  // GET /api/bookings
  if (pathname === '/api/bookings' && req.method === 'GET') {
    try {
      const date = parsedUrl.searchParams.get('date');
      await dbAdapter.purgeExpiredBookings(new Date());
      const bookings = await dbAdapter.getBookings(date);
      return sendJson(res, 200, { bookings });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error cargando reservas.' });
    }
  }

  // POST /api/bookings
  if (pathname === '/api/bookings' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { userId, date, court, slot, simulatedNow } = body;

      if (!userId || !date || !court || !slot) {
        return sendJson(res, 400, { error: 'Faltan datos de la reserva (usuario, fecha, cancha o turno).' });
      }

      if (!COURTS.includes(court)) {
        return sendJson(res, 400, { error: 'Cancha inválida.' });
      }

      if (!SLOTS.includes(slot)) {
        return sendJson(res, 400, { error: 'Horario de turno inválido.' });
      }

      const [user, settings] = await Promise.all([
        dbAdapter.findUserById(userId),
        dbAdapter.getSettings()
      ]);

      if (!user) {
        return sendJson(res, 404, { error: 'Usuario no encontrado. Por favor registrate con tu mail.' });
      }

      const now = simulatedNow ? new Date(simulatedNow) : new Date();
      await dbAdapter.purgeExpiredBookings(now);

      const windowCheck = checkBookingWindow(date, user.role, now);
      if (!windowCheck.allowed) {
        return sendJson(res, 403, { error: windowCheck.reason });
      }

      const slotStartTs = getSlotStartTimestamp(date, slot);
      const nowTs = new Date(now).getTime();
      if (slotStartTs && slotStartTs <= nowTs) {
        return sendJson(res, 400, { error: 'No se pueden reservar turnos cuyo horario ya haya comenzado o finalizado.' });
      }

      const existingBookings = await dbAdapter.getBookings(date);
      const existingSlot = existingBookings.find(
        b => b.court === court && b.slot === slot
      );
      if (existingSlot) {
        return sendJson(res, 409, {
          error: `El turno ${slot} en ${court} ya está reservado por ${existingSlot.userName}.`
        });
      }

      if (user.role !== 'profesor') {
        const userBookingsForDay = existingBookings.filter(
          b => b.userId === user.id
        );
        if (userBookingsForDay.length >= 1) {
          return sendJson(res, 403, {
            error: `Solo se permite reservar 1 turno por día por socio. Ya tenés reservado el turno de ${userBookingsForDay[0].slot} en ${userBookingsForDay[0].court} para el día ${date}.`
          });
        }
      }

      // Jugadores (modalidad singles o dobles)
      const modalidad = body.modalidad === 'dobles' ? 'dobles' : 'singles';
      const players = Array.isArray(body.players) ? body.players : [];

      // Validar si hay algún no socio en el grupo que requiera transferencia
      const nonMembersInGroup = [];
      if (user.memberType === 'no_socio') {
        nonMembersInGroup.push({ name: `${user.nombre} ${user.apellido}`, isHolder: true });
      }
      players.forEach(p => {
        if (!p.isSocio && p.nombre && p.nombre.trim()) {
          nonMembersInGroup.push({ name: p.nombre.trim(), dni: p.dni || '', isHolder: false });
        }
      });

      const requiresPayment = nonMembersInGroup.length > 0;
      const countNonMembers = Math.min(Math.max(nonMembersInGroup.length, 1), 4);
      const pricingKey = `price${countNonMembers}`;
      const amountToPay = requiresPayment ? (settings.pricing[pricingKey] || DEFAULT_PRICES[pricingKey]) : 0;

      const newBooking = {
        id: 'bk-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        date,
        court,
        slot,
        userId: user.id,
        userName: `${user.nombre} ${user.apellido}`,
        userDni: user.dni,
        userCelular: user.celular || '',
        userMail: user.mail,
        userRole: user.role || 'socio',
        memberType: user.memberType || 'socio',
        modalidad,
        players,
        nonMembersInGroup,
        amountToPay,
        status: requiresPayment ? 'pendiente_pago' : 'confirmada',
        paymentProof: null,
        createdAt: now.toISOString(),
        expiresAt: requiresPayment ? new Date(now.getTime() + 10 * 60 * 1000).toISOString() : null
      };

      await dbAdapter.saveBooking(newBooking);

      if (!requiresPayment) {
        await sendConfirmationEmailAsync(newBooking, user);
      }

      return sendJson(res, 201, {
        booking: newBooking,
        requiresPayment,
        nonMembersInGroup,
        amountToPay,
        bankInfo: settings.bankInfo || DEFAULT_BANK_INFO
      });
    } catch (e) {
      return sendJson(res, 400, { error: 'No se pudo procesar la reserva.' });
    }
  }

  // POST /api/bookings/:id/payment (No-socio upload receipt within 10 min)
  if (pathname.includes('/payment') && req.method === 'POST') {
    try {
      const bookingId = pathname.split('/')[3];
      const body = await parseBody(req);
      const { proofName, simulatedNow } = body;

      const booking = await dbAdapter.getBookingById(bookingId);
      if (!booking) {
        return sendJson(res, 404, { error: 'La reserva no existe o ya expiró por superar los 10 minutos.' });
      }

      const now = simulatedNow ? new Date(simulatedNow) : new Date();
      const created = new Date(booking.createdAt).getTime();
      if (now.getTime() - created > 10 * 60 * 1000) {
        await dbAdapter.deleteBookingById(bookingId);
        return sendJson(res, 400, { error: 'Se cumplieron los 10 minutos límites para adjuntar el comprobante. El turno se ha liberado.' });
      }

      booking.status = 'confirmada';
      booking.paymentProof = proofName || 'comprobante_transferencia.pdf';
      booking.confirmedAt = now.toISOString();

      await dbAdapter.saveBooking(booking);

      const user = await dbAdapter.findUserById(booking.userId);
      if (user) {
        await sendConfirmationEmailAsync(booking, user);
      }

      return sendJson(res, 200, { booking, message: 'Pago verificado y reserva confirmada con éxito.' });
    } catch (e) {
      return sendJson(res, 400, { error: 'Error al confirmar pago.' });
    }
  }

  // DELETE /api/bookings/:id
  if (pathname.startsWith('/api/bookings/') && req.method === 'DELETE') {
    try {
      const bookingId = pathname.replace('/api/bookings/', '');
      const userId = parsedUrl.searchParams.get('userId');
      const userDni = (parsedUrl.searchParams.get('userDni') || '').trim();
      const userMail = (parsedUrl.searchParams.get('userMail') || '').trim().toLowerCase();

      const booking = await dbAdapter.getBookingById(bookingId);
      if (!booking) {
        return sendJson(res, 404, { error: 'Reserva no encontrada.' });
      }

      let reqUser = null;
      if (userId) reqUser = await dbAdapter.findUserById(userId);
      if (!reqUser && userDni) reqUser = await dbAdapter.findUserByDni(userDni);
      if (!reqUser && userMail) reqUser = await dbAdapter.findUserByMail(userMail);

      const isOwner = (userId && booking.userId === userId) ||
                      (userDni && booking.userDni === userDni) ||
                      (userMail && booking.userMail && booking.userMail.toLowerCase() === userMail) ||
                      (reqUser && (booking.userId === reqUser.id || booking.userDni === reqUser.dni));

      const isAdmin = (userDni && isAdminUser(userDni)) || 
                      userDni === '31610066' || 
                      (reqUser && reqUser.role === 'admin');

      const isProf = (userDni && (userDni === '47039935' || userDni === '25410483')) || 
                     (reqUser && reqUser.role === 'profesor');

      // Permitir cancelar si es el dueño del turno, si es admin, si es profesor, o si el turno está pendiente de pago
      if (!isOwner && !isAdmin && !isProf && booking.status !== 'pendiente_pago') {
        return sendJson(res, 403, { error: 'Solo el titular de la reserva, un profesor o un administrador puede cancelarla.' });
      }

      await dbAdapter.deleteBookingById(bookingId);

      // Notificar cancelación por email al titular y en copia a los profesores
      try {
        const bookingUser = await dbAdapter.findUserById(booking.userId) || {
          nombre: (booking.userName || '').split(' ')[0] || '',
          apellido: (booking.userName || '').split(' ').slice(1).join(' ') || '',
          mail: booking.userMail
        };
        const cancelledByName = reqUser ? `${reqUser.nombre} ${reqUser.apellido}` : null;
        const settings = await dbAdapter.getSettings();
        await mailer.sendBookingCancellationEmail(booking, bookingUser, cancelledByName, settings.emailConfig);
      } catch (err) {
        console.warn('Aviso de cancelación por mail:', err.message);
      }

      return sendJson(res, 200, { ok: true, message: 'Reserva cancelada correctamente.' });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error cancelando reserva.' });
    }
  }

  // GET, POST & DELETE /api/socios (Admin padrón management & ABM individual)
  if (pathname === '/api/socios' && req.method === 'GET') {
    try {
      const list = await dbAdapter.getSociosPadron();
      return sendJson(res, 200, { socios: list, total: list.length });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error obteniendo padrón.' });
    }
  }

  // Alta o Modificación manual de 1 socio
  if (pathname === '/api/socios' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const dni = cleanDni(body.dni);
      const nombre = (body.nombre || '').trim();
      const categoria = body.categoria || 'socio';

      if (!dni || dni.length < 6) {
        return sendJson(res, 400, { error: 'El DNI debe tener al menos 6 dígitos numéricos.' });
      }
      if (!nombre) {
        return sendJson(res, 400, { error: 'El Nombre y Apellido es obligatorio.' });
      }

      const item = await dbAdapter.addOrUpdateSocio({ dni, nombre, categoria });

      // Si el usuario ya está registrado en users, actualizar condición de socio
      const user = await dbAdapter.findUserByDni(dni);
      if (user && user.role !== 'admin' && user.role !== 'profesor') {
        user.memberType = 'socio';
        await dbAdapter.saveOrUpdateUser(user);
      }

      return sendJson(res, 201, {
        ok: true,
        socio: item,
        message: `Socio ${nombre} (DNI ${dni}) guardado exitosamente en el padrón oficial.`
      });
    } catch (e) {
      return sendJson(res, 400, { error: 'Error al agregar o modificar socio.' });
    }
  }

  // Baja individual de socio del padrón
  if (pathname.startsWith('/api/socios/') && req.method === 'DELETE') {
    try {
      const rawDni = pathname.replace('/api/socios/', '');
      const dni = cleanDni(rawDni);

      if (!dni) {
        return sendJson(res, 400, { error: 'DNI inválido.' });
      }

      // Proteger a los administradores y profesores del club
      if (['31610066', '47039935', '25410483'].includes(dni)) {
        return sendJson(res, 403, { error: 'No se puede dar de baja del padrón a administradores o profesores oficiales.' });
      }

      await dbAdapter.deleteSocioByDni(dni);

      // Si el usuario está registrado, su condición pasa a no socio
      const user = await dbAdapter.findUserByDni(dni);
      if (user && user.role !== 'admin' && user.role !== 'profesor') {
        user.memberType = 'no_socio';
        await dbAdapter.saveOrUpdateUser(user);
      }

      return sendJson(res, 200, {
        ok: true,
        message: `El socio con DNI ${dni} ha sido dado de baja del padrón oficial.`
      });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error al eliminar socio.' });
    }
  }

  if (pathname === '/api/socios/import' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { socios } = body;
      if (!Array.isArray(socios)) {
        return sendJson(res, 400, { error: 'El listado debe ser una lista de socios con DNI.' });
      }
      const formatted = socios.map(s => ({
        dni: cleanDni(s.dni),
        nombre: (s.nombre || '').trim(),
        categoria: s.categoria || 'socio'
      })).filter(s => s.dni.length >= 6);

      await dbAdapter.saveSociosPadron(formatted);

      // Re-cruzar usuarios existentes
      const users = await dbAdapter.getUsers();
      for (const u of users) {
        if (u.role !== 'profesor' && u.role !== 'admin') {
          const isSocio = formatted.some(s => s.dni === cleanDni(u.dni));
          u.memberType = isSocio ? 'socio' : 'no_socio';
          await dbAdapter.saveOrUpdateUser(u);
        }
      }

      return sendJson(res, 200, {
        ok: true,
        totalImported: formatted.length,
        message: `Padrón actualizado exitosamente con ${formatted.length} socios.`
      });
    } catch (e) {
      return sendJson(res, 400, { error: 'Error procesando archivo de socios.' });
    }
  }

  // GET /api/stats (Admin panel statistics)
  if (pathname === '/api/stats' && req.method === 'GET') {
    try {
      await dbAdapter.purgeExpiredBookings(new Date());

      const [allBookings, users, settings, recentEmails] = await Promise.all([
        dbAdapter.getBookings(),
        dbAdapter.getUsers(),
        dbAdapter.getSettings(),
        dbAdapter.getRecentEmails(10)
      ]);

      const totalUsers = users.length;
      const sociosCount = users.filter(u => u.memberType === 'socio' || !u.memberType).length;
      const noSociosCount = users.filter(u => u.memberType === 'no_socio').length;
      const totalBookings = allBookings.length;

      // Users ranking: most bookings requested
      const userStats = {};
      const slotStats = {};

      allBookings.forEach(b => {
        // User aggregate
        if (!userStats[b.userId]) {
          userStats[b.userId] = {
            userId: b.userId,
            name: b.userName,
            dni: b.userDni,
            mail: b.userMail,
            memberType: b.memberType || 'socio',
            totalBookings: 0,
            slotsCount: {}
          };
        }
        userStats[b.userId].totalBookings++;
        userStats[b.userId].slotsCount[b.slot] = (userStats[b.userId].slotsCount[b.slot] || 0) + 1;

        // Slot general demand
        slotStats[b.slot] = (slotStats[b.slot] || 0) + 1;
      });

      const userRanking = Object.values(userStats).map(u => {
        let favoriteSlot = null;
        let favoriteSlotCount = 0;
        for (const [slot, count] of Object.entries(u.slotsCount)) {
          if (count > favoriteSlotCount) {
            favoriteSlot = slot;
            favoriteSlotCount = count;
          }
        }
        const dominancePct = u.totalBookings > 0 ? Math.round((favoriteSlotCount / u.totalBookings) * 100) : 0;
        return {
          ...u,
          favoriteSlot,
          favoriteSlotCount,
          dominancePct,
          isSlotLocker: dominancePct >= 70 && u.totalBookings >= 3
        };
      }).sort((a, b) => b.totalBookings - a.totalBookings);

      return sendJson(res, 200, {
        totalUsers,
        sociosCount,
        noSociosCount,
        totalBookings,
        allBookings,
        registeredUsers: users.map(u => ({
          id: u.id,
          nombre: u.nombre,
          apellido: u.apellido,
          dni: u.dni,
          celular: u.celular,
          mail: u.mail,
          role: u.role,
          memberType: u.memberType
        })),
        userRanking,
        slotStats,
        pricing: settings.pricing || DEFAULT_PRICES,
        bankInfo: settings.bankInfo || DEFAULT_BANK_INFO,
        recentEmails
      });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error cargando estadísticas.' });
    }
  }

  // GET /api/emails (For demo & tracking sent emails)
  if (pathname === '/api/emails' && req.method === 'GET') {
    try {
      const emails = await dbAdapter.getRecentEmails(50);
      return sendJson(res, 200, { emails });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error cargando emails.' });
    }
  }

  // Static files
  let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Recurso no encontrado');
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    };
    res.writeHead(200, headers);
    res.end(content);
  });
});

server.listen(PORT, async () => {
  console.log(`Servidor de Reservas Tenis - Sportivo FC de Álvarez corriendo en http://localhost:${PORT}`);
  try {
    await dbAdapter.checkSupabaseReady();
  } catch (e) {
    console.error('Error al inicializar conexión con base de datos:', e.message);
  }
});
