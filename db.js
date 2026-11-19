const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://iptxbshugtufinzuvkqk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_ylmVvEYSrp6oOKHUUWPRNA_sR_G7e-0';

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SOCIOS_FILE = path.join(DATA_DIR, 'socios_tenis.json');

const DEFAULT_PRICES = {
  price1: 4500,
  price2: 8000,
  price3: 11000,
  price4: 14000
};

const DEFAULT_BANK_INFO = {
  banco: 'Banco Macro / Red Link',
  titular: 'Sportivo Fútbol Club de Álvarez',
  cuit: '30-68123456-9',
  cbu: '2850381140094123456789',
  alias: 'SPORTIVO.ALVAREZ.TENIS',
  nota: 'Subir comprobante en la web o transferir antes de los 10 minutos.'
};

let supabase = null;
let supabaseConnected = false;

try {
  if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
  }
} catch (e) {
  console.warn('No se pudo inicializar cliente de Supabase:', e.message);
}

// --- Local JSON Database Fallback ---
function readLocalDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      users: [
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
      ],
      bookings: [],
      emails: [],
      pricing: DEFAULT_PRICES,
      bankInfo: DEFAULT_BANK_INFO
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { users: [], bookings: [], emails: [], pricing: DEFAULT_PRICES, bankInfo: DEFAULT_BANK_INFO };
  }
}

function writeLocalDb(data) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function readLocalSocios() {
  if (fs.existsSync(SOCIOS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8'));
    } catch (e) {}
  }
  return [
    { dni: '31610066', nombre: 'Federico Milesi', categoria: 'socio' },
    { dni: '47039935', nombre: 'Jarno Cefarelli', categoria: 'profesor' },
    { dni: '25410483', nombre: 'Leonardo Albertoli', categoria: 'profesor' }
  ];
}

function writeLocalSocios(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SOCIOS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// Check if Supabase tables exist and connection is working
async function checkSupabaseReady() {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.from('users').select('id').limit(1);
    if (!error) {
      supabaseConnected = true;
      console.log('✅ Conexión con Supabase verificada: Base de datos en la nube ACTIVA.');
      return true;
    } else {
      console.warn('⚠️ Supabase respondió con error (¿Tablas creadas?):', error.message);
      supabaseConnected = false;
      return false;
    }
  } catch (e) {
    console.warn('⚠️ No se pudo conectar con Supabase, usando persistencia local:', e.message);
    supabaseConnected = false;
    return false;
  }
}

// Initial check non-blocking
checkSupabaseReady();

// --- Users operations ---
async function getUsers() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*');
      if (!error && data) {
        supabaseConnected = true;
        return data.map(u => ({
          id: u.id,
          nombre: u.nombre,
          apellido: u.apellido,
          dni: u.dni,
          celular: u.celular,
          mail: u.mail,
          role: u.role,
          memberType: u.member_type || 'socio'
        }));
      }
    } catch (e) {
      console.warn('Error leyendo usuarios de Supabase:', e.message);
    }
  }
  return readLocalDb().users;
}

async function findUserByDni(dni) {
  const clean = String(dni || '').trim().replace(/\D/g, '');
  if (!clean) return null;
  if (supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('dni', clean).maybeSingle();
      if (!error && data) {
        supabaseConnected = true;
        return {
          id: data.id,
          nombre: data.nombre,
          apellido: data.apellido,
          dni: data.dni,
          celular: data.celular,
          mail: data.mail,
          role: data.role,
          memberType: data.member_type || 'socio'
        };
      }
    } catch (e) {}
  }
  const db = readLocalDb();
  return db.users.find(u => u.dni === clean) || null;
}

async function findUserByMail(mail) {
  const clean = (mail || '').trim().toLowerCase();
  if (!clean) return null;
  if (supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('mail', clean).maybeSingle();
      if (!error && data) {
        supabaseConnected = true;
        return {
          id: data.id,
          nombre: data.nombre,
          apellido: data.apellido,
          dni: data.dni,
          celular: data.celular,
          mail: data.mail,
          role: data.role,
          memberType: data.member_type || 'socio'
        };
      }
    } catch (e) {}
  }
  const db = readLocalDb();
  return db.users.find(u => (u.mail || '').toLowerCase() === clean) || null;
}

async function findUserById(id) {
  if (!id) return null;
  if (supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
      if (!error && data) {
        supabaseConnected = true;
        return {
          id: data.id,
          nombre: data.nombre,
          apellido: data.apellido,
          dni: data.dni,
          celular: data.celular,
          mail: data.mail,
          role: data.role,
          memberType: data.member_type || 'socio'
        };
      }
    } catch (e) {}
  }
  const db = readLocalDb();
  return db.users.find(u => u.id === id) || null;
}

async function saveOrUpdateUser(userObj) {
  // Always update local DB for instant fallback
  const localDb = readLocalDb();
  const idx = localDb.users.findIndex(u => u.id === userObj.id || u.dni === userObj.dni || u.mail === userObj.mail);
  if (idx !== -1) {
    localDb.users[idx] = { ...localDb.users[idx], ...userObj };
  } else {
    localDb.users.push(userObj);
  }
  writeLocalDb(localDb);

  if (supabase) {
    try {
      const payload = {
        id: userObj.id,
        nombre: userObj.nombre,
        apellido: userObj.apellido,
        dni: userObj.dni,
        celular: userObj.celular,
        mail: userObj.mail,
        role: userObj.role || 'socio',
        member_type: userObj.memberType || 'socio'
      };
      await supabase.from('users').upsert(payload, { onConflict: 'id' });
      supabaseConnected = true;
    } catch (e) {
      console.warn('Error guardando usuario en Supabase:', e.message);
    }
  }
  return userObj;
}

async function updateUser(userId, updates) {
  const existing = await findUserById(userId);
  if (!existing) return null;
  const merged = { ...existing, ...updates };
  return await saveOrUpdateUser(merged);
}

// --- Bookings operations ---
async function getBookings(date = null) {
  if (supabase) {
    try {
      let query = supabase.from('bookings').select('*');
      if (date) query = query.eq('date', date);
      const { data, error } = await query;
      if (!error && data) {
        supabaseConnected = true;
        return data.map(b => ({
          id: b.id,
          date: b.date,
          court: b.court,
          slot: b.slot,
          userId: b.user_id,
          userName: b.user_name,
          userDni: b.user_dni,
          userCelular: b.user_celular,
          userMail: b.user_mail,
          userRole: b.user_role,
          memberType: b.member_type,
          modalidad: b.modalidad,
          players: b.players || [],
          nonMembersInGroup: b.non_members_in_group || [],
          amountToPay: Number(b.amount_to_pay) || 0,
          status: b.status,
          paymentProof: b.payment_proof,
          createdAt: b.created_at,
          expiresAt: b.expires_at,
          confirmedAt: b.confirmed_at
        }));
      }
    } catch (e) {
      console.warn('Error leyendo reservas de Supabase:', e.message);
    }
  }
  const db = readLocalDb();
  return date ? db.bookings.filter(b => b.date === date) : db.bookings;
}

async function getBookingById(bookingId) {
  if (!bookingId) return null;
  if (supabase) {
    try {
      const { data, error } = await supabase.from('bookings').select('*').eq('id', bookingId).maybeSingle();
      if (!error && data) {
        supabaseConnected = true;
        return {
          id: data.id,
          date: data.date,
          court: data.court,
          slot: data.slot,
          userId: data.user_id,
          userName: data.user_name,
          userDni: data.user_dni,
          userCelular: data.user_celular,
          userMail: data.user_mail,
          userRole: data.user_role,
          memberType: data.member_type,
          modalidad: data.modalidad,
          players: data.players || [],
          nonMembersInGroup: data.non_members_in_group || [],
          amountToPay: Number(data.amount_to_pay) || 0,
          status: data.status,
          paymentProof: data.payment_proof,
          createdAt: data.created_at,
          expiresAt: data.expires_at,
          confirmedAt: data.confirmed_at
        };
      }
    } catch (e) {}
  }
  const db = readLocalDb();
  return db.bookings.find(b => b.id === bookingId) || null;
}

async function saveBooking(booking) {
  // Save local
  const localDb = readLocalDb();
  const idx = localDb.bookings.findIndex(b => b.id === booking.id);
  if (idx !== -1) {
    localDb.bookings[idx] = booking;
  } else {
    localDb.bookings.push(booking);
  }
  writeLocalDb(localDb);

  // Save Supabase
  if (supabase) {
    try {
      const payload = {
        id: booking.id,
        date: booking.date,
        court: booking.court,
        slot: booking.slot,
        user_id: booking.userId,
        user_name: booking.userName,
        user_dni: booking.userDni,
        user_celular: booking.userCelular || '',
        user_mail: booking.userMail,
        user_role: booking.userRole || 'socio',
        member_type: booking.memberType || 'socio',
        modalidad: booking.modalidad || 'singles',
        players: booking.players || [],
        non_members_in_group: booking.nonMembersInGroup || [],
        amount_to_pay: booking.amountToPay || 0,
        status: booking.status || 'confirmada',
        payment_proof: booking.paymentProof || null,
        created_at: booking.createdAt,
        expires_at: booking.expiresAt || null,
        confirmed_at: booking.confirmedAt || null
      };
      await supabase.from('bookings').upsert(payload, { onConflict: 'id' });
      supabaseConnected = true;
    } catch (e) {
      console.warn('Error guardando reserva en Supabase:', e.message);
    }
  }
  return booking;
}

async function deleteBookingById(bookingId) {
  // Local
  const localDb = readLocalDb();
  localDb.bookings = (localDb.bookings || []).filter(b => b.id !== bookingId);
  writeLocalDb(localDb);

  // Supabase
  if (supabase) {
    try {
      await supabase.from('bookings').delete().eq('id', bookingId);
      supabaseConnected = true;
    } catch (e) {
      console.warn('Error borrando reserva de Supabase:', e.message);
    }
  }
}

async function purgeExpiredBookings(now = new Date()) {
  const tenMinMs = 10 * 60 * 1000;
  
  // Local purge
  const localDb = readLocalDb();
  const expiredIds = [];
  localDb.bookings = (localDb.bookings || []).filter(b => {
    if (b.status === 'pendiente_pago') {
      const created = new Date(b.createdAt).getTime();
      if (now.getTime() - created > tenMinMs + 30000) {
        expiredIds.push(b.id);
        return false;
      }
    }
    return true;
  });
  writeLocalDb(localDb);

  // Supabase purge
  if (supabase) {
    try {
      const { data } = await supabase
        .from('bookings')
        .select('id, created_at, status')
        .eq('status', 'pendiente_pago');
      
      if (data && data.length > 0) {
        for (const item of data) {
          const created = new Date(item.created_at).getTime();
          if (now.getTime() - created > tenMinMs + 30000) {
            await supabase.from('bookings').delete().eq('id', item.id);
          }
        }
      }
    } catch (e) {}
  }
}

// --- Padron Socios operations ---
async function getSociosPadron() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('socios_padron').select('*');
      if (!error && data && data.length > 0) {
        supabaseConnected = true;
        return data;
      }
    } catch (e) {}
  }
  return readLocalSocios();
}

async function saveSociosPadron(list) {
  writeLocalSocios(list);
  if (supabase) {
    try {
      const batches = [];
      for (let i = 0; i < list.length; i += 100) {
        batches.push(list.slice(i, i + 100));
      }
      for (const batch of batches) {
        await supabase.from('socios_padron').upsert(batch, { onConflict: 'dni' });
      }
      supabaseConnected = true;
    } catch (e) {
      console.warn('Error guardando padrón en Supabase:', e.message);
    }
  }
}

async function addOrUpdateSocio(socio) {
  const clean = String(socio.dni || '').trim().replace(/\D/g, '');
  if (!clean) return null;
  const item = {
    dni: clean,
    nombre: (socio.nombre || '').trim(),
    categoria: socio.categoria || 'socio'
  };

  // Local
  const list = readLocalSocios();
  const idx = list.findIndex(s => s.dni === clean);
  if (idx !== -1) {
    list[idx] = item;
  } else {
    list.push(item);
  }
  writeLocalSocios(list);

  // Supabase
  if (supabase) {
    try {
      await supabase.from('socios_padron').upsert(item, { onConflict: 'dni' });
      supabaseConnected = true;
    } catch (e) {
      console.warn('Error guardando socio en Supabase:', e.message);
    }
  }
  return item;
}

async function deleteSocioByDni(dni) {
  const clean = String(dni || '').trim().replace(/\D/g, '');
  if (!clean) return;

  // Local
  const list = readLocalSocios().filter(s => s.dni !== clean);
  writeLocalSocios(list);

  // Supabase
  if (supabase) {
    try {
      await supabase.from('socios_padron').delete().eq('dni', clean);
      supabaseConnected = true;
    } catch (e) {
      console.warn('Error borrando socio de Supabase:', e.message);
    }
  }
}

// --- Settings operations ---
async function getSettings() {
  let pricing = { ...DEFAULT_PRICES };
  let bankInfo = { ...DEFAULT_BANK_INFO };

  if (supabase) {
    try {
      const { data, error } = await supabase.from('club_settings').select('*');
      if (!error && data && data.length > 0) {
        supabaseConnected = true;
        data.forEach(item => {
          if (item.key === 'pricing' && item.data) pricing = item.data;
          if (item.key === 'bank_info' && item.data) bankInfo = item.data;
        });
        return { pricing, bankInfo };
      }
    } catch (e) {}
  }

  const localDb = readLocalDb();
  return {
    pricing: localDb.pricing || pricing,
    bankInfo: localDb.bankInfo || bankInfo
  };
}

async function saveSettings(pricing, bankInfo) {
  const localDb = readLocalDb();
  if (pricing) localDb.pricing = pricing;
  if (bankInfo) localDb.bankInfo = bankInfo;
  writeLocalDb(localDb);

  if (supabase) {
    try {
      if (pricing) {
        await supabase.from('club_settings').upsert({ key: 'pricing', data: pricing }, { onConflict: 'key' });
      }
      if (bankInfo) {
        await supabase.from('club_settings').upsert({ key: 'bank_info', data: bankInfo }, { onConflict: 'key' });
      }
      supabaseConnected = true;
    } catch (e) {
      console.warn('Error guardando configuración en Supabase:', e.message);
    }
  }
}

// --- Sent Emails operations ---
async function getRecentEmails(limit = 10) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('sent_emails')
        .select('*')
        .order('id', { ascending: false })
        .limit(limit);
      if (!error && data) {
        supabaseConnected = true;
        return data.map(em => ({
          to: em.to_email,
          content: em.content,
          date: em.created_at
        }));
      }
    } catch (e) {}
  }
  const db = readLocalDb();
  return (db.emails || []).slice(-limit).reverse();
}

async function logSentEmail(to, content) {
  const localDb = readLocalDb();
  if (!Array.isArray(localDb.emails)) localDb.emails = [];
  localDb.emails.push({ to, content, date: new Date().toISOString() });
  writeLocalDb(localDb);

  if (supabase) {
    try {
      await supabase.from('sent_emails').insert({ to_email: to, content });
    } catch (e) {}
  }
}

module.exports = {
  checkSupabaseReady,
  getUsers,
  findUserByDni,
  findUserByMail,
  findUserById,
  saveOrUpdateUser,
  updateUser,
  getBookings,
  getBookingById,
  saveBooking,
  deleteBookingById,
  purgeExpiredBookings,
  getSociosPadron,
  saveSociosPadron,
  addOrUpdateSocio,
  deleteSocioByDni,
  getSettings,
  saveSettings,
  getRecentEmails,
  logSentEmail,
  DEFAULT_PRICES,
  DEFAULT_BANK_INFO
};
