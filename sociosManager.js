const fs = require('fs');
const path = require('path');

const SOCIOS_FILE = path.join(__dirname, 'data', 'socios_tenis.json');

// Normaliza DNI (solo dígitos sin puntos ni espacios)
function cleanDni(dni) {
  return String(dni || '').trim().replace(/\D/g, '');
}

function ensureSociosFile() {
  const dataDir = path.dirname(SOCIOS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(SOCIOS_FILE)) {
    // Lista inicial de prueba que se reemplaza con el archivo real que suba el usuario
    const initialSocios = [
      { dni: '11111111', nombre: 'Jarno Cefarelli', categoria: 'profesor' },
      { dni: '22222222', nombre: 'Leonardo Albertoli', categoria: 'profesor' },
      { dni: '31610066', nombre: 'Federico Milesi', categoria: 'socio' },
      { dni: '35123456', nombre: 'Socio Ejemplo', categoria: 'socio' }
    ];
    fs.writeFileSync(SOCIOS_FILE, JSON.stringify(initialSocios, null, 2), 'utf8');
  }
}

function getSociosList() {
  ensureSociosFile();
  try {
    const raw = fs.readFileSync(SOCIOS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function checkIsSocio(dni) {
  const cleaned = cleanDni(dni);
  if (!cleaned) return false;
  const list = getSociosList();
  return list.some(s => cleanDni(s.dni) === cleaned);
}

function saveSociosList(list) {
  ensureSociosFile();
  fs.writeFileSync(SOCIOS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

module.exports = {
  getSociosList,
  checkIsSocio,
  saveSociosList,
  cleanDni
};
