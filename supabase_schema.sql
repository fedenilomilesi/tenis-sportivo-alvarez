-- Schema inicial para Tenis Sportivo Fútbol Club de Álvarez (SFC)
-- Copiá y pegá este script en el "SQL Editor" de Supabase y hacé clic en "RUN".

-- 1. Tabla de Usuarios
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  apellido TEXT NOT NULL,
  dni TEXT UNIQUE NOT NULL,
  celular TEXT NOT NULL,
  mail TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'socio', -- 'admin', 'profesor', 'socio'
  member_type TEXT NOT NULL DEFAULT 'socio', -- 'socio', 'no_socio'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de Reservas
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL, -- 'YYYY-MM-DD'
  court TEXT NOT NULL, -- 'Cancha 1', 'Cancha 2'
  slot TEXT NOT NULL, -- '14:00 a 15:30 hs', etc.
  user_id TEXT,
  user_name TEXT NOT NULL,
  user_dni TEXT NOT NULL,
  user_celular TEXT,
  user_mail TEXT NOT NULL,
  user_role TEXT NOT NULL DEFAULT 'socio',
  member_type TEXT NOT NULL DEFAULT 'socio',
  modalidad TEXT DEFAULT 'singles', -- 'singles', 'dobles'
  players JSONB DEFAULT '[]'::jsonb,
  non_members_in_group JSONB DEFAULT '[]'::jsonb,
  amount_to_pay NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmada', -- 'confirmada', 'pendiente_pago'
  payment_proof TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
);

-- 3. Tabla de Padrón Oficial de Socios
CREATE TABLE IF NOT EXISTS socios_padron (
  dni TEXT PRIMARY KEY,
  nombre TEXT,
  categoria TEXT DEFAULT 'socio'
);

-- 4. Tabla de Configuración del Club (Aranceles No Socios y Datos Bancarios)
CREATE TABLE IF NOT EXISTS club_settings (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

-- 5. Tabla de Mails de Notificación
CREATE TABLE IF NOT EXISTS sent_emails (
  id BIGSERIAL PRIMARY KEY,
  to_email TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_users_dni ON users(dni);
CREATE INDEX IF NOT EXISTS idx_users_mail ON users(mail);

-- Deshabilitar RLS para acceso API directo de backend con publishable/service key
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE bookings DISABLE ROW LEVEL SECURITY;
ALTER TABLE socios_padron DISABLE ROW LEVEL SECURITY;
ALTER TABLE club_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE sent_emails DISABLE ROW LEVEL SECURITY;

-- Datos iniciales del Administrador y Profesores
INSERT INTO users (id, nombre, apellido, dni, celular, mail, role, member_type)
VALUES
  ('admin-fede', 'Federico', 'Milesi', '31610066', '3413441162', 'fedenilomilesi@gmail.com', 'admin', 'socio'),
  ('prof-jarno', 'Jarno', 'Cefarelli', '47039935', '3402521352', 'jarnocefarelli@gmail.com', 'profesor', 'socio'),
  ('prof-leonardo', 'Leonardo', 'Albertoli', '25410483', '3402521352', 'leonardoalbertoli@gmail.com', 'profesor', 'socio'),
  ('admin-sportivo', 'Administración', 'Sportivo FC', '00000000', '3402521352', 'admin@sportivoalvarez.com', 'admin', 'socio')
ON CONFLICT (dni) DO NOTHING;

-- Padrón inicial
INSERT INTO socios_padron (dni, nombre, categoria)
VALUES
  ('31610066', 'Federico Milesi', 'socio'),
  ('47039935', 'Jarno Cefarelli', 'profesor'),
  ('25410483', 'Leonardo Albertoli', 'profesor')
ON CONFLICT (dni) DO NOTHING;

-- Configuración inicial
INSERT INTO club_settings (key, data)
VALUES
  ('pricing', '{"price1": 4500, "price2": 8000, "price3": 11000, "price4": 14000}'::jsonb),
  ('bank_info', '{"banco": "Banco Macro / Red Link", "titular": "Sportivo Fútbol Club de Álvarez", "cuit": "30-68123456-9", "cbu": "2850381140094123456789", "alias": "SPORTIVO.ALVAREZ.TENIS", "nota": "Subir comprobante en la web o transferir antes de los 10 minutos."}'::jsonb)
ON CONFLICT (key) DO NOTHING;
