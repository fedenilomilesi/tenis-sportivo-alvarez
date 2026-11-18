const http = require('http');
const fs = require('fs');
const path = require('path');
const { getSociosList, checkIsSocio, saveSociosList, cleanDni } = require('./sociosManager');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
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

const DEFAULT_USERS = [
  {
    id: 'admin-fede',
    nombre: 'Federico',
    apellido: 'Milesi',
    dni: '31610066',
    celular: '3413441162',
    mail: 'fedenilomilesi@gmail.com',
    role: 'admin',
    memberType: 'socio'
  },
  {
    id: 'prof-jarno',
    nombre: 'Jarno',
    apellido: 'Cefarelli',
    dni: '47039935',
    celular: '3402521352',
    mail: 'jarnocefarelli@gmail.com',
    role: 'profesor',
    memberType: 'socio'
  },
  {
    id: 'prof-leonardo',
    nombre: 'Leonardo',
    apellido: 'Albertoli',
    dni: '25410483',
    celular: '3402521352',
    mail: 'leonardoalbertoli@gmail.com',
    role: 'profesor',
    memberType: 'socio'
  },
  {
    id: 'admin-sportivo',
    nombre: 'Administración',
    apellido: 'Sportivo FC',
    dni: '00000000',
    celular: '3402521352',
    mail: 'admin@sportivoalvarez.com',
    role: 'admin',
    memberType: 'socio'
  }
];

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      users: [...DEFAULT_USERS],
      bookings: [],
      emails: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data.emails) data.emails = [];
    return data;
  } catch (e) {
    return { users: [...DEFAULT_USERS], bookings: [], emails: [] };
  }
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

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

// Cleanup pending unconfirmed non-member bookings older than 5 minutes
function purgeExpiredBookings(db, now) {
  const fiveMinMs = 5 * 60 * 1000;
  const initialLen = db.bookings.length;
  db.bookings = db.bookings.filter(b => {
    if (b.status === 'pendiente_pago') {
      const created = new Date(b.createdAt).getTime();
      if (now.getTime() - created > fiveMinMs) {
        return false; // Expire and free up slot!
      }
    }
    return true;
  });
  if (db.bookings.length !== initialLen) {
    writeDb(db);
  }
}

// Emulate Email Notification
function sendConfirmationEmail(db, booking, user) {
  const isNoSocio = user.memberType === 'no_socio';
  const emailItem = {
    id: 'em-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    to: user.mail,
    subject: `Confirmación de Reserva - ${booking.court} (${booking.slot}) - Sportivo FC Álvarez`,
    date: new Date().toISOString(),
    content: `
Estimado/a ${user.nombre} ${user.apellido},

¡Tu turno ha sido confirmado con éxito!

Detalles de la Reserva:
- Cancha: ${booking.court} (Polvo de Ladrillo)
- Fecha: ${booking.date}
- Turno: ${booking.slot}
- Condición: ${isNoSocio ? 'No Socio (Pago por transferencia verificado)' : 'Socio de Tenis SFCA'}

AVISO MUY IMPORTANTE:
"Si por alguna razón no vas a poder usar el turno, por favor cancelalo a tiempo desde la web para que otro socio pueda aprovecharlo y disfrutar de la cancha."

Consultas o administración: 3402 521352
Sportivo Fútbol Club de Álvarez
    `.trim()
  };

  db.emails.push(emailItem);
  console.log(`[EMAIL ENVIADO a ${user.mail}]: ${emailItem.subject}`);
  return emailItem;
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

  // GET /api/config
  if (pathname === '/api/config' && req.method === 'GET') {
    const db = readDb();
    return sendJson(res, 200, {
      slots: SLOTS,
      courts: COURTS,
      professors: db.users.filter(u => u.role === 'profesor')
    });
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

      const db = readDb();
      
      // Validación estricta de unicidad 1 DNI <-> 1 solo Mail
      const userByDni = db.users.find(u => u.dni === dni);
      const userByMail = db.users.find(u => u.mail === mail);

      // Si el DNI ya está registrado con otro mail diferente, rechazar
      if (userByDni && userByDni.mail !== mail) {
        return sendJson(res, 409, {
          error: `El DNI ${dni} ya se encuentra registrado con el correo: ${userByDni.mail}. Para ingresar usá ese correo o comunicate con el club.`
        });
      }

      // Si el Mail ya está registrado con otro DNI diferente, rechazar
      if (userByMail && userByMail.dni !== dni) {
        return sendJson(res, 409, {
          error: `El correo ${mail} ya está asociado al DNI ${userByMail.dni}. Cada documento solo puede tener 1 único correo electrónico.`
        });
      }

      let user = userByDni || userByMail;
      const isAdmin = isAdminUser(dni) || (user && user.role === 'admin');
      const isProf = !isAdmin && (isProfessorUser(nombre, apellido, dni) || (user && user.role === 'profesor'));

      // Cruce automático con el padrón oficial de socios de tenis por DNI
      const isRegisteredSocio = isAdmin || isProf || checkIsSocio(dni);
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
        db.users.push(user);
      }

      writeDb(db);
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

      const db = readDb();
      const user = db.users.find(u => 
        (userId && u.id === userId) ||
        (mail && u.mail.toLowerCase() === mail) ||
        (dni && u.dni === dni)
      );

      if (!user) {
        return sendJson(res, 404, { error: 'No se encontró una cuenta con ese correo electrónico o DNI. Por favor completá el registro inicial una sola vez.' });
      }

      // Re-verificar si es admin o profe por DNI al loguearse
      const userCleanDni = cleanDni(user.dni);
      if (isAdminUser(userCleanDni)) {
        user.role = 'admin';
        user.memberType = 'socio';
        writeDb(db);
      } else if (PROF_DNIS.includes(userCleanDni) || isProfessorUser(user.nombre, user.apellido, user.dni)) {
        user.role = 'profesor';
        user.memberType = 'socio';
        writeDb(db);
      }

      return sendJson(res, 200, { user });
    } catch (e) {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  // GET /api/bookings
  if (pathname === '/api/bookings' && req.method === 'GET') {
    const date = parsedUrl.searchParams.get('date');
    const db = readDb();
    purgeExpiredBookings(db, new Date());
    const bookings = date ? db.bookings.filter(b => b.date === date) : db.bookings;
    return sendJson(res, 200, { bookings });
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

      const db = readDb();
      const user = db.users.find(u => u.id === userId);
      if (!user) {
        return sendJson(res, 404, { error: 'Usuario no encontrado. Por favor registrate con tu mail.' });
      }

      const now = simulatedNow ? new Date(simulatedNow) : new Date();
      purgeExpiredBookings(db, now);

      const windowCheck = checkBookingWindow(date, user.role, now);
      if (!windowCheck.allowed) {
        return sendJson(res, 403, { error: windowCheck.reason });
      }

      const slotStartTs = getSlotStartTimestamp(date, slot);
      const nowTs = new Date(now).getTime();
      if (slotStartTs && slotStartTs <= nowTs) {
        return sendJson(res, 400, { error: 'No se pueden reservar turnos cuyo horario ya haya comenzado o finalizado.' });
      }

      const existingSlot = db.bookings.find(
        b => b.date === date && b.court === court && b.slot === slot
      );
      if (existingSlot) {
        return sendJson(res, 409, {
          error: `El turno ${slot} en ${court} ya está reservado por ${existingSlot.userName}.`
        });
      }

      if (user.role !== 'profesor') {
        const userBookingsForDay = db.bookings.filter(
          b => b.date === date && b.userId === user.id
        );
        if (userBookingsForDay.length >= 1) {
          return sendJson(res, 403, {
            error: `Solo se permite reservar 1 turno por día por socio. Ya tenés reservado el turno de ${userBookingsForDay[0].slot} en ${userBookingsForDay[0].court} para el día ${date}.`
          });
        }
      }

      const isNoSocio = user.memberType === 'no_socio';
      const newBooking = {
        id: 'bk-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        date,
        court,
        slot,
        userId: user.id,
        userName: `${user.nombre} ${user.apellido}`,
        userDni: user.dni,
        userCelular: user.celular,
        userMail: user.mail,
        userRole: user.role,
        memberType: user.memberType || 'socio',
        status: isNoSocio ? 'pendiente_pago' : 'confirmada',
        paymentProof: null,
        createdAt: now.toISOString(),
        expiresAt: isNoSocio ? new Date(now.getTime() + 5 * 60 * 1000).toISOString() : null
      };

      db.bookings.push(newBooking);

      if (!isNoSocio) {
        sendConfirmationEmail(db, newBooking, user);
      }

      writeDb(db);
      return sendJson(res, 201, { booking: newBooking });
    } catch (e) {
      return sendJson(res, 400, { error: 'No se pudo procesar la reserva.' });
    }
  }

  // POST /api/bookings/:id/payment (No-socio upload receipt within 5 min)
  if (pathname.includes('/payment') && req.method === 'POST') {
    try {
      const bookingId = pathname.split('/')[3];
      const body = await parseBody(req);
      const { proofName, simulatedNow } = body;

      const db = readDb();
      const booking = db.bookings.find(b => b.id === bookingId);
      if (!booking) {
        return sendJson(res, 404, { error: 'La reserva no existe o ya expiró por superar los 5 minutos.' });
      }

      const now = simulatedNow ? new Date(simulatedNow) : new Date();
      const created = new Date(booking.createdAt).getTime();
      if (now.getTime() - created > 5 * 60 * 1000) {
        db.bookings = db.bookings.filter(b => b.id !== bookingId);
        writeDb(db);
        return sendJson(res, 400, { error: 'Se cumplieron los 5 minutos límites para adjuntar el comprobante. El turno se ha liberado.' });
      }

      booking.status = 'confirmada';
      booking.paymentProof = proofName || 'comprobante_transferencia.pdf';
      booking.confirmedAt = now.toISOString();

      const user = db.users.find(u => u.id === booking.userId);
      if (user) {
        sendConfirmationEmail(db, booking, user);
      }

      writeDb(db);
      return sendJson(res, 200, { booking, message: 'Pago verificado y reserva confirmada con éxito.' });
    } catch (e) {
      return sendJson(res, 400, { error: 'Error al confirmar pago.' });
    }
  }

  // DELETE /api/bookings/:id
  if (pathname.startsWith('/api/bookings/') && req.method === 'DELETE') {
    const bookingId = pathname.replace('/api/bookings/', '');
    const userId = parsedUrl.searchParams.get('userId');
    const db = readDb();
    const index = db.bookings.findIndex(b => b.id === bookingId);
    if (index === -1) {
      return sendJson(res, 404, { error: 'Reserva no encontrada.' });
    }
    const booking = db.bookings[index];
    const reqUser = db.users.find(u => u.id === userId);
    if (booking.userId !== userId && (!reqUser || reqUser.role !== 'profesor' && reqUser.role !== 'admin')) {
      return sendJson(res, 403, { error: 'Solo el titular de la reserva, un profesor o un administrador puede cancelarla.' });
    }
    db.bookings.splice(index, 1);
    writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  // GET & POST /api/socios (Admin padrón management)
  if (pathname === '/api/socios' && req.method === 'GET') {
    const list = getSociosList();
    return sendJson(res, 200, { socios: list, total: list.length });
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

      saveSociosList(formatted);

      // Re-cross existing users in db
      const db = readDb();
      db.users.forEach(u => {
        if (u.role !== 'profesor' && u.role !== 'admin') {
          u.memberType = checkIsSocio(u.dni) ? 'socio' : 'no_socio';
        }
      });
      writeDb(db);

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
    const db = readDb();
    purgeExpiredBookings(db, new Date());

    const totalUsers = db.users.length;
    const sociosCount = db.users.filter(u => u.memberType === 'socio' || !u.memberType).length;
    const noSociosCount = db.users.filter(u => u.memberType === 'no_socio').length;
    const totalBookings = db.bookings.length;

    // Users ranking: most bookings requested
    const userStats = {};
    const slotStats = {};

    db.bookings.forEach(b => {
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
      // Determine if they always book the same slot (blocking others)
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
      userRanking,
      slotStats,
      recentEmails: db.emails.slice(-10).reverse()
    });
  }

  // GET /api/emails (For demo & tracking sent emails)
  if (pathname === '/api/emails' && req.method === 'GET') {
    const db = readDb();
    return sendJson(res, 200, { emails: db.emails || [] });
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
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor de Reservas Tenis - Sportivo FC de Álvarez corriendo en http://localhost:${PORT}`);
});
