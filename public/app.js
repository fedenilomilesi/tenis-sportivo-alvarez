// Constants & Default Data
const DEFAULT_SLOTS = [
  '14:00 a 15:30 hs',
  '15:30 a 17:00 hs',
  '17:00 a 18:30 hs',
  '18:30 a 20:00 hs',
  '20:00 a 21:30 hs',
  '21:30 a 23:00 hs'
];

const DEFAULT_COURTS = ['Cancha 1', 'Cancha 2'];

const DEFAULT_PROFESSORS = [
  {
    id: 'prof-jarno',
    nombre: 'Jarno',
    apellido: 'Cefarelli',
    dni: '11111111',
    celular: '3402521352',
    mail: 'jarno.cefarelli@sportivoalvarez.com',
    role: 'profesor'
  },
  {
    id: 'prof-leonardo',
    nombre: 'Leonardo',
    apellido: 'Albertoli',
    dni: '22222222',
    celular: '3402521352',
    mail: 'leonardo.albertoli@sportivoalvarez.com',
    role: 'profesor'
  }
];

let config = {
  slots: [...DEFAULT_SLOTS],
  courts: [...DEFAULT_COURTS],
  professors: [...DEFAULT_PROFESSORS]
};

let currentUser = null;
let selectedDayTarget = 'today'; // 'today' | 'tomorrow'
let timeMode = 'real'; // 'real' | 'sim-20' | 'sim-21' | 'sim-18'
let bookingsForDate = [];
let backendAvailable = false;

let pendingNonMemberBooking = null;
let paymentTimerInterval = null;

// DOM References
const currentTimeDisplay = document.getElementById('current-time-display');
const timeModeSelect = document.getElementById('time-mode-select');
const authCard = document.getElementById('auth-card');
const profileCard = document.getElementById('profile-card');
const registerForm = document.getElementById('register-form');
const quickLoginForm = document.getElementById('quick-login-form');
const btnLogout = document.getElementById('btn-logout');
const btnProfJarno = document.getElementById('btn-prof-jarno');
const btnProfLeonardo = document.getElementById('btn-prof-leonardo');

const tabToday = document.getElementById('tab-today');
const tabTomorrow = document.getElementById('tab-tomorrow');
const labelDateToday = document.getElementById('label-date-today');
const labelDateTomorrow = document.getElementById('label-date-tomorrow');
const windowStatusBanner = document.getElementById('window-status-banner');
const feedbackAlert = document.getElementById('feedback-alert');
const courtsContainer = document.getElementById('courts-container');
const selectedDateTitle = document.getElementById('selected-date-title');
const myBookingsList = document.getElementById('my-bookings-list');

const paymentModal = document.getElementById('payment-modal');
const paymentTimer = document.getElementById('payment-timer');
const paymentForm = document.getElementById('payment-form');
const btnCancelPayment = document.getElementById('btn-cancel-payment');

// --- LocalStorage Fallback Database (when index.html is opened directly or without Node server) ---
function getLocalDb() {
  try {
    const raw = localStorage.getItem('sfca_tenis_local_db');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.users) && Array.isArray(parsed.bookings)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error leyendo base local:', e);
  }
  const initial = {
    users: [...DEFAULT_PROFESSORS],
    bookings: []
  };
  saveLocalDb(initial);
  return initial;
}

function saveLocalDb(db) {
  try {
    localStorage.setItem('sfca_tenis_local_db', JSON.stringify(db));
  } catch (e) {
    console.warn('Error guardando base local:', e);
  }
}

function isProfessorName(nombre, apellido) {
  const full = `${nombre} ${apellido}`
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    (full.includes('jarno') && full.includes('cefarelli')) ||
    (full.includes('leonardo') && full.includes('albertoli'))
  );
}

// Returns current effective Date (either real clock or simulated time today)
function getEffectiveNow() {
  const real = new Date();
  if (timeMode === 'real') return real;
  const simulated = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 0, 0, 0);
  if (timeMode === 'sim-20') {
    simulated.setHours(20, 15, 0);
  } else if (timeMode === 'sim-21') {
    simulated.setHours(21, 15, 0);
  } else if (timeMode === 'sim-18') {
    simulated.setHours(18, 0, 0);
  }
  return simulated;
}

function formatDateYMD(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateHuman(dateObj) {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const dName = days[dateObj.getDay()];
  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${dName} ${d}/${m}/${y}`;
}

function getTargetDateObj() {
  const now = getEffectiveNow();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  if (selectedDayTarget === 'tomorrow') {
    base.setDate(base.getDate() + 1);
  }
  return base;
}

function getSlotStartTime(dateStr, slotStr) {
  const match = slotStr.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

function isSlotPassed(targetDateStr, slotStr, now) {
  const slotStartTime = getSlotStartTime(targetDateStr, slotStr);
  if (!slotStartTime) return false;
  return slotStartTime <= now;
}

function checkWindowFrontend(targetDateObj, role, now) {
  const openHour = role === 'profesor' ? 20 : 21;
  const openTime = new Date(
    targetDateObj.getFullYear(),
    targetDateObj.getMonth(),
    targetDateObj.getDate() - 1,
    openHour,
    0,
    0,
    0
  );

  if (now >= openTime) {
    return {
      isOpen: true,
      isProfPriorityWindow:
        now >=
          new Date(
            targetDateObj.getFullYear(),
            targetDateObj.getMonth(),
            targetDateObj.getDate() - 1,
            20,
            0,
            0
          ) &&
        now <
          new Date(
            targetDateObj.getFullYear(),
            targetDateObj.getMonth(),
            targetDateObj.getDate() - 1,
            21,
            0,
            0
          )
    };
  }

  return {
    isOpen: false,
    openTime
  };
}

function showFeedback(message, type = 'success') {
  feedbackAlert.textContent = message;
  feedbackAlert.className = `feedback-alert ${type}`;
  feedbackAlert.classList.remove('hidden');
  setTimeout(() => {
    feedbackAlert.classList.add('hidden');
  }, 6500);
}

function updateClockAndLabels() {
  const now = getEffectiveNow();
  const timeStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  currentTimeDisplay.textContent = `${formatDateHuman(now)} - ${timeStr} hs`;

  const todayObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  labelDateToday.textContent = formatDateHuman(todayObj);
  labelDateTomorrow.textContent = formatDateHuman(tomorrowObj);
}

function renderProfile() {
  const mobileUserName = document.getElementById('mobile-user-name');
  const mobileUserStatus = document.getElementById('mobile-user-status');
  const navAdminBtn = document.getElementById('nav-admin-btn');
  const simControls = document.getElementById('sim-controls-wrapper');

  if (!currentUser) {
    authCard.classList.remove('hidden');
    profileCard.classList.add('hidden');
    if (navAdminBtn) navAdminBtn.style.display = 'none';
    if (simControls) simControls.style.display = 'none';
    if (mobileUserName && mobileUserStatus) {
      mobileUserName.textContent = 'Sin registrar / identificar';
      mobileUserStatus.textContent = 'Tocá para ingresar con tu Mail';
    }
    return;
  }

  authCard.classList.add('hidden');
  profileCard.classList.remove('hidden');

  const isProf = currentUser.role === 'profesor';
  const isAdmin = currentUser.role === 'admin';

  // Solo profesores o administradores tienen acceso a panel / pruebas avanzadas
  if (navAdminBtn) {
    navAdminBtn.style.display = (isProf || isAdmin) ? 'inline-flex' : 'none';
  }
  if (simControls) {
    // Si querés activar simulación de horarios, podés agregarlo con ?demo=true en la url
    const hasDemoParam = new URLSearchParams(window.location.search).has('demo');
    simControls.style.display = (hasDemoParam || isAdmin) ? 'flex' : 'none';
  }

  const badge = document.getElementById('profile-role-badge');
  badge.textContent = isProf ? '🎾 Profesor Oficial (Prioridad)' : isAdmin ? '🛡️ Administrador' : 'Socio / Jugador';
  badge.className = `role-badge ${isProf ? 'role-profesor' : ''}`;

  document.getElementById('profile-name').textContent = `${currentUser.nombre} ${currentUser.apellido}`;
  document.getElementById('profile-dni').textContent = currentUser.dni;
  document.getElementById('profile-celular').textContent = currentUser.celular;
  document.getElementById('profile-mail').textContent = currentUser.mail;

  const isNoSocio = currentUser.memberType === 'no_socio';
  if (mobileUserName && mobileUserStatus) {
    mobileUserName.textContent = `${currentUser.nombre} ${currentUser.apellido}`;
    mobileUserStatus.textContent = isProf
      ? '🎾 Profesor Oficial (Prioridad)'
      : isNoSocio
      ? `${currentUser.mail} • No Socio (Transf.)`
      : `${currentUser.mail} • Socio SFCA`;
  }

  const privBox = document.getElementById('profile-privilege-info');
  if (isProf) {
    privBox.className = 'privilege-box prof';
    privBox.innerHTML =
      '<strong>Prioridad de Profesor Activa:</strong> Podés reservar <strong>más de 1 turno por día</strong> y tenés acceso desde las <strong>20:00 hs del día anterior</strong> (1 hora antes que el resto de los usuarios).';
  } else if (isNoSocio) {
    privBox.className = 'privilege-box';
    privBox.style.borderColor = '#fdba74';
    privBox.style.background = '#fff7ed';
    privBox.style.color = '#9a3412';
    privBox.innerHTML =
      '<strong>Condición No Socio:</strong> Podés reservar 1 turno por día a partir de las 21:00 hs. Una vez elegido el turno tenés <strong>5 minutos</strong> para transferir el arancel y adjuntar el comprobante para confirmarlo.';
  } else {
    privBox.className = 'privilege-box';
    privBox.style.borderColor = '#bbf7d0';
    privBox.style.background = '#f0fdf4';
    privBox.style.color = '#166534';
    privBox.innerHTML =
      '<strong>Socio de Tenis SFCA:</strong> Podés reservar <strong>1 solo turno por día</strong> a partir de las <strong>21:00 hs del día anterior</strong> sin costo adicional.';
  }
}

function renderStatusBanner() {
  const now = getEffectiveNow();
  const targetDateObj = getTargetDateObj();

  selectedDateTitle.textContent = formatDateHuman(targetDateObj);

  if (selectedDayTarget === 'today') {
    windowStatusBanner.className = 'status-banner open';
    windowStatusBanner.innerHTML = `
      <div>
        <strong>✅ Turnos de HOY (${formatDateHuman(targetDateObj)}) HABILITADOS</strong>
        <div>La apertura fue ayer a las 21:00 hs (20:00 hs para profesores). Elegí cualquier turno libre en Cancha 1 o Cancha 2.</div>
      </div>
    `;
    return;
  }

  // Tomorrow selected
  const profOpenCheck = checkWindowFrontend(targetDateObj, 'profesor', now);
  const socioOpenCheck = checkWindowFrontend(targetDateObj, 'socio', now);

  if (socioOpenCheck.isOpen) {
    windowStatusBanner.className = 'status-banner open';
    windowStatusBanner.innerHTML = `
      <div>
        <strong>✅ Turnos de MAÑANA (${formatDateHuman(targetDateObj)}) ABIERTOS PARA TODOS</strong>
        <div>Ya pasaron las 21:00 hs. Cada socio puede reservar 1 turno y los profesores múltiples turnos.</div>
      </div>
    `;
  } else if (profOpenCheck.isOpen) {
    windowStatusBanner.className = 'status-banner prof-only';
    windowStatusBanner.innerHTML = `
      <div>
        <strong>⭐ VENTANA EXCLUSIVA DE PRIORIDAD PROFESORES (20:00 a 21:00 hs)</strong>
        <div>Actualmente solo <strong>Jarno Cefarelli</strong> y <strong>Leonardo Albertoli</strong> pueden reservar turnos para mañana. Para el resto de los usuarios abre hoy a las <strong>21:00 hs</strong>.</div>
      </div>
    `;
  } else {
    windowStatusBanner.className = 'status-banner closed';
    windowStatusBanner.innerHTML = `
      <div>
        <strong>🔒 Turnos de MAÑANA (${formatDateHuman(targetDateObj)}) AÚN CERRADOS</strong>
        <div>Se habilitan hoy a las <strong>20:00 hs para los profesores</strong> (Jarno Cefarelli y Leonardo Albertoli) y a las <strong>21:00 hs para todos los usuarios</strong>. <em>(Podés probar la apertura cambiando el "Modo Horario" arriba a la derecha)</em>.</div>
      </div>
    `;
  }
}

function renderCourts() {
  const courtsLockedMsg = document.getElementById('courts-locked-msg');

  // Si el usuario no ha ingresado / iniciado sesión, ocultar grilla y mostrar cartel de bloqueo
  if (!currentUser) {
    if (courtsLockedMsg) courtsLockedMsg.classList.remove('hidden');
    courtsContainer.classList.add('hidden');
    return;
  }

  // Usuario autenticado: mostrar grilla de turnos
  if (courtsLockedMsg) courtsLockedMsg.classList.add('hidden');
  courtsContainer.classList.remove('hidden');

  const now = getEffectiveNow();
  const targetDateObj = getTargetDateObj();
  const targetDateStr = formatDateYMD(targetDateObj);
  const role = currentUser.role || 'socio';
  const win = checkWindowFrontend(targetDateObj, role, now);

  const userHasBookedToday =
    currentUser.role !== 'profesor' &&
    bookingsForDate.some(b => b.userId === currentUser.id);

  courtsContainer.innerHTML = '';

  config.courts.forEach(courtName => {
    const col = document.createElement('div');
    col.className = 'court-column';

    const header = document.createElement('div');
    header.className = 'court-header';
    header.innerHTML = `
      <h3>🎾 ${courtName}</h3>
      <span class="court-surface">Polvo de Ladrillo</span>
    `;
    col.appendChild(header);

    const list = document.createElement('div');
    list.className = 'slots-list';

    config.slots.forEach(slotLabel => {
      const booking = bookingsForDate.find(
        b => b.court === courtName && b.slot === slotLabel
      );

      const item = document.createElement('div');

      if (booking) {
        const isMine = currentUser && booking.userId === currentUser.id;
        const isProfBooking = booking.userRole === 'profesor';
        item.className = `slot-item ${isMine ? 'booked-mine' : isProfBooking ? 'booked-prof' : 'booked'}`;

        // Regla: Los usuarios comunes solo pueden cancelar SU propio turno.
        // Los profesores o administradores tienen la facultad de liberar o cancelar turnos si es necesario.
        const canCancel =
          currentUser && (booking.userId === currentUser.id || currentUser.role === 'profesor' || currentUser.role === 'admin');

        item.innerHTML = `
          <div>
            <div class="slot-time">${slotLabel}</div>
            <div class="slot-status">
              ${isProfBooking ? '🎾 <strong>Clase / Profesor:</strong> ' : 'Reservado por: '}
              <strong>${booking.userName}</strong>
            </div>
          </div>
          <div>
            ${
              canCancel
                ? `<button type="button" class="btn-cancel" data-cancel-id="${booking.id}">Cancelar</button>`
                : `<button type="button" class="btn-book" disabled>Ocupado</button>`
            }
          </div>
        `;
      } else {
        const passed = isSlotPassed(targetDateStr, slotLabel, now);
        item.className = `slot-item available ${passed ? 'slot-passed' : ''}`;
        let disabledReason = '';
        let canClick = true;

        if (passed) {
          disabledReason = 'Horario pasado';
          canClick = false;
        } else if (!currentUser) {
          disabledReason = 'Completá tu registro a la izquierda para reservar';
          canClick = true; // Allow click so we can guide them or auto-register if form is filled!
        } else if (!win.isOpen) {
          disabledReason = currentUser.role === 'profesor' ? 'Abre 20:00 hs' : 'Abre 21:00 hs';
          canClick = false;
        } else if (userHasBookedToday) {
          disabledReason = 'Límite 1 turno/día';
          canClick = false;
        }

        item.innerHTML = `
          <div>
            <div class="slot-time" style="${passed ? 'text-decoration: line-through; color: #94a3b8;' : ''}">${slotLabel}</div>
            <div class="slot-status" style="color: ${passed ? '#94a3b8' : '#15803d'}; font-weight: 600;">
              ${passed ? '✕ Horario finalizado' : '● Disponible'}
            </div>
          </div>
          <div>
            <button
              type="button"
              class="btn-book"
              data-court="${courtName}"
              data-slot="${slotLabel}"
              ${!canClick ? 'disabled' : ''}
              title="${disabledReason}"
            >
              ${canClick ? 'Reservar Turno' : disabledReason}
            </button>
          </div>
        `;
      }

      list.appendChild(item);
    });

    col.appendChild(list);
    courtsContainer.appendChild(col);
  });

  // Attach events
  courtsContainer.querySelectorAll('button[data-court]').forEach(btn => {
    btn.addEventListener('click', () => {
      const court = btn.getAttribute('data-court');
      const slot = btn.getAttribute('data-slot');
      handleCreateBooking(targetDateStr, court, slot);
    });
  });

  courtsContainer.querySelectorAll('button[data-cancel-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-cancel-id');
      handleCancelBooking(id);
    });
  });

  renderMyBookings();
}

function renderMyBookings() {
  if (!currentUser) {
    myBookingsList.innerHTML =
      '<p class="empty-msg">Completá tus datos y hacé clic en "Guardar Datos e Ingresar" (o elegí directamente un turno después de llenar tus datos) para ver tus reservas aquí.</p>';
    return;
  }

  const mine = bookingsForDate.filter(b => b.userId === currentUser.id);
  if (mine.length === 0) {
    myBookingsList.innerHTML =
      '<p class="empty-msg">No tenés turnos reservados en la fecha seleccionada.</p>';
    return;
  }

  myBookingsList.innerHTML = '';
  mine.forEach(b => {
    const row = document.createElement('div');
    row.className = 'my-booking-row';
    row.innerHTML = `
      <div>
        <strong>${b.court}</strong> • <strong>${b.slot}</strong>
        <span style="color: #475569; margin-left: 0.5rem;">(${b.userName} - DNI ${b.userDni})</span>
      </div>
      <button type="button" class="btn-cancel" data-my-cancel="${b.id}">Cancelar Reserva</button>
    `;
    row.querySelector('button').addEventListener('click', () => handleCancelBooking(b.id));
    myBookingsList.appendChild(row);
  });
}

// --- Non-member payment timer logic ---
function openPaymentModal(booking) {
  pendingNonMemberBooking = booking;
  paymentModal.classList.remove('hidden');

  let timeLeftSeconds = 5 * 60;
  function updateTimerText() {
    const mins = Math.floor(timeLeftSeconds / 60);
    const secs = timeLeftSeconds % 60;
    paymentTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (timeLeftSeconds <= 0) {
      clearInterval(paymentTimerInterval);
      paymentModal.classList.add('hidden');
      showFeedback('Se cumplieron los 5 minutos límites para adjuntar el comprobante. El turno se ha liberado.', 'error');
      loadBookingsForSelectedDate();
    }
    timeLeftSeconds--;
  }

  updateTimerText();
  clearInterval(paymentTimerInterval);
  paymentTimerInterval = setInterval(updateTimerText, 1000);
}

if (paymentForm) {
  paymentForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!pendingNonMemberBooking) return;

    const fileInput = document.getElementById('payment-file');
    const fileName = fileInput.files[0] ? fileInput.files[0].name : 'comprobante_transferencia.pdf';

    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(pendingNonMemberBooking.id)}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proofName: fileName,
          simulatedNow: getEffectiveNow().toISOString()
        })
      });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || 'No se pudo verificar el comprobante.', 'error');
        return;
      }
      clearInterval(paymentTimerInterval);
      paymentModal.classList.add('hidden');
      showFeedback(
        `¡Comprobante recibido y reserva confirmada! Te enviamos un correo a ${currentUser.mail} con los detalles y el recordatorio de cancelación.`,
        'success'
      );
      loadBookingsForSelectedDate();
    } catch (err) {
      showFeedback('Error al subir el comprobante de transferencia.', 'error');
    }
  });
}

if (btnCancelPayment) {
  btnCancelPayment.addEventListener('click', async () => {
    if (pendingNonMemberBooking) {
      await handleCancelBooking(pendingNonMemberBooking.id);
    }
    clearInterval(paymentTimerInterval);
    paymentModal.classList.add('hidden');
  });
}

// --- Data Layer (supports Backend API + LocalStorage Fallback seamlessly) ---
async function registerOrUpdateUser(payload) {
  const nombre = (payload.nombre || '').trim();
  const apellido = (payload.apellido || '').trim();
  const dni = String(payload.dni || '').trim().replace(/\D/g, '');
  const celular = String(payload.celular || '').trim();
  const mail = (payload.mail || '').trim().toLowerCase();
  const memberType = payload.memberType || 'socio';

  if (!nombre || !apellido || !dni || !celular || !mail) {
    throw new Error('Todos los campos (Nombre, Apellido, DNI, Celular y Mail) son obligatorios.');
  }

  if (backendAvailable) {
    try {
      const res = await fetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, apellido, dni, celular, mail, memberType })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al registrar usuario.');
      return data.user;
    } catch (err) {
      if (err.message && !err.message.includes('Failed to fetch')) throw err;
      backendAvailable = false;
    }
  }

  // Fallback LocalStorage
  const db = getLocalDb();
  let user = db.users.find(u => u.mail === mail || u.dni === dni);
  const isProf = isProfessorName(nombre, apellido) || (user && user.role === 'profesor');

  if (user) {
    user.nombre = nombre;
    user.apellido = apellido;
    user.celular = celular;
    user.mail = mail;
    user.memberType = memberType;
    if (isProf) user.role = 'profesor';
  } else {
    user = {
      id: 'usr-' + Date.now(),
      nombre,
      apellido,
      dni,
      celular,
      mail,
      memberType,
      role: isProf ? 'profesor' : 'socio'
    };
    db.users.push(user);
  }
  saveLocalDb(db);
  return user;
}

async function loginByMailOrDni({ mail, dni, userId }) {
  if (backendAvailable) {
    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mail, dni, userId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Usuario no encontrado.');
      return data.user;
    } catch (err) {
      if (err.message && !err.message.includes('Failed to fetch')) throw err;
      backendAvailable = false;
    }
  }

  const db = getLocalDb();
  const cleanDni = String(dni || '').trim().replace(/\D/g, '');
  const cleanMail = (mail || '').trim().toLowerCase();
  const user = db.users.find(u => 
    (cleanMail && u.mail && u.mail.toLowerCase() === cleanMail) ||
    (cleanDni && u.dni === cleanDni) ||
    (userId && u.id === userId)
  );
  if (!user) {
    throw new Error('No se encontró una cuenta con ese correo electrónico. Si es tu primera vez, completá el formulario de arriba.');
  }
  return user;
}

async function loadBookingsForSelectedDate() {
  const targetDateStr = formatDateYMD(getTargetDateObj());

  // Always render immediately so UI never looks empty
  renderStatusBanner();
  renderCourts();

  if (backendAvailable) {
    try {
      const res = await fetch(`/api/bookings?date=${encodeURIComponent(targetDateStr)}`);
      if (res.ok) {
        const data = await res.json();
        bookingsForDate = data.bookings || [];
        renderStatusBanner();
        renderCourts();
        return;
      }
    } catch (err) {
      backendAvailable = false;
    }
  }

  const db = getLocalDb();
  bookingsForDate = db.bookings.filter(b => b.date === targetDateStr);
  renderStatusBanner();
  renderCourts();
}

async function handleCreateBooking(date, court, slot) {
  // If user filled the form on the left but forgot to click "Guardar Datos e Ingresar", auto-register them!
  if (!currentUser) {
    const nombreVal = document.getElementById('nombre').value.trim();
    const apellidoVal = document.getElementById('apellido').value.trim();
    const dniVal = document.getElementById('dni').value.trim();
    const celularVal = document.getElementById('celular').value.trim();
    const mailVal = document.getElementById('mail').value.trim();

    if (nombreVal && apellidoVal && dniVal && celularVal && mailVal) {
      try {
        const memberTypeVal = document.getElementById('member-type') ? document.getElementById('member-type').value : 'socio';
        currentUser = await registerOrUpdateUser({
          nombre: nombreVal,
          apellido: apellidoVal,
          dni: dniVal,
          celular: celularVal,
          mail: mailVal,
          memberType: memberTypeVal
        });
        localStorage.setItem('sfca_tenis_user', JSON.stringify(currentUser));
        renderProfile();
      } catch (err) {
        showFeedback(err.message, 'error');
        return;
      }
    } else {
      showFeedback(
        'Por favor completá tu registro o ingresá con tu Mail en el panel izquierdo para reservar.',
        'error'
      );
      return;
    }
  }

  if (backendAvailable) {
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          date,
          court,
          slot,
          simulatedNow: getEffectiveNow().toISOString()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || 'No se pudo reservar el turno.', 'error');
        return;
      }

      const booking = data.booking;
      if (booking.status === 'pendiente_pago') {
        openPaymentModal(booking);
        showFeedback('Turno pre-reservado. Disponés de 5 minutos para subir el comprobante de transferencia.', 'success');
      } else {
        showFeedback(
          `¡Turno reservado con éxito! Se envió la confirmación a ${currentUser.mail}. Recordá cancelarlo con anticipación si no lo vas a usar.`,
          'success'
        );
      }
      await loadBookingsForSelectedDate();
      return;
    } catch (err) {
      backendAvailable = false;
    }
  }

  // Fallback LocalStorage booking validation
  const now = getEffectiveNow();
  const targetDateObj = getTargetDateObj();
  const win = checkWindowFrontend(targetDateObj, currentUser.role, now);
  if (!win.isOpen) {
    showFeedback(
      currentUser.role === 'profesor'
        ? 'La reserva para profesores abre a las 20:00 hs del día anterior.'
        : 'La reserva abre a las 21:00 hs del día anterior. No se pueden reservar turnos hacia adelante.',
      'error'
    );
    return;
  }

  if (isSlotPassed(date, slot, now)) {
    showFeedback('No se pueden reservar turnos cuyo horario ya haya comenzado o finalizado.', 'error');
    return;
  }

  const db = getLocalDb();
  const existing = db.bookings.find(b => b.date === date && b.court === court && b.slot === slot);
  if (existing) {
    showFeedback(`El turno ${slot} en ${court} ya está ocupado por ${existing.userName}.`, 'error');
    return;
  }

  if (currentUser.role !== 'profesor') {
    const userDayBookings = db.bookings.filter(b => b.date === date && b.userId === currentUser.id);
    if (userDayBookings.length >= 1) {
      showFeedback(
        `Solo podés reservar 1 turno por día. Ya tenés reservado ${userDayBookings[0].slot} en ${userDayBookings[0].court}.`,
        'error'
      );
      return;
    }
  }

  const isNoSocio = currentUser.memberType === 'no_socio';
  const newBooking = {
    id: 'bk-' + Date.now(),
    date,
    court,
    slot,
    userId: currentUser.id,
    userName: `${currentUser.nombre} ${currentUser.apellido}`,
    userDni: currentUser.dni,
    userCelular: currentUser.celular,
    userMail: currentUser.mail,
    userRole: currentUser.role,
    memberType: currentUser.memberType || 'socio',
    status: isNoSocio ? 'pendiente_pago' : 'confirmada',
    createdAt: now.toISOString()
  };

  db.bookings.push(newBooking);
  saveLocalDb(db);

  if (isNoSocio) {
    openPaymentModal(newBooking);
  } else {
    showFeedback(
      `¡Turno confirmado para ${currentUser.nombre} ${currentUser.apellido}! Correo de confirmación enviado a ${currentUser.mail}.`,
      'success'
    );
  }
  await loadBookingsForSelectedDate();
}

async function handleCancelBooking(bookingId) {
  if (!currentUser) return;

  if (backendAvailable) {
    try {
      const res = await fetch(
        `/api/bookings/${encodeURIComponent(bookingId)}?userId=${encodeURIComponent(currentUser.id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || 'No se pudo cancelar la reserva.', 'error');
        return;
      }
      showFeedback('Reserva cancelada correctamente. El turno volvió a estar disponible.', 'success');
      await loadBookingsForSelectedDate();
      return;
    } catch (err) {
      backendAvailable = false;
    }
  }

  const db = getLocalDb();
  const idx = db.bookings.findIndex(b => b.id === bookingId);
  if (idx !== -1) {
    db.bookings.splice(idx, 1);
    saveLocalDb(db);
    showFeedback('Reserva cancelada correctamente. El turno volvió a estar disponible.', 'success');
    await loadBookingsForSelectedDate();
  }
}

// Event Listeners
registerForm.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const user = await registerOrUpdateUser({
      nombre: document.getElementById('nombre').value,
      apellido: document.getElementById('apellido').value,
      dni: document.getElementById('dni').value,
      celular: document.getElementById('celular').value,
      mail: document.getElementById('reg-mail').value || document.getElementById('mail').value
    });
    currentUser = user;
    localStorage.setItem('sfca_tenis_user', JSON.stringify(currentUser));
    renderProfile();
    renderStatusBanner();
    renderCourts();
    showFeedback(`¡Bienvenido/a ${currentUser.nombre} ${currentUser.apellido}! Tu cuenta quedó registrada con éxito. Ya podés ver los turnos.`, 'success');
  } catch (err) {
    showFeedback(err.message || 'No se pudo guardar el registro.', 'error');
  }
});

quickLoginForm.addEventListener('submit', async e => {
  e.preventDefault();
  const mailInput = document.getElementById('login-mail') || document.getElementById('login-dni');
  const mailVal = mailInput.value.trim();
  try {
    const user = await loginByMailOrDni({ mail: mailVal, dni: mailVal });
    currentUser = user;
    localStorage.setItem('sfca_tenis_user', JSON.stringify(currentUser));
    renderProfile();
    renderStatusBanner();
    renderCourts();
    showFeedback(`Sesión iniciada como ${currentUser.nombre} ${currentUser.apellido} (${currentUser.mail}).`, 'success');
  } catch (err) {
    showFeedback(err.message || 'Usuario no encontrado.', 'error');
  }
});

async function loginAsProfessor(userId) {
  try {
    const user = await loginByMailOrDni({ userId });
    currentUser = user;
    localStorage.setItem('sfca_tenis_user', JSON.stringify(currentUser));
    renderProfile();
    renderStatusBanner();
    renderCourts();
    showFeedback(
      `Ingresaste como Profesor ${currentUser.nombre} ${currentUser.apellido} (Prioridad desde las 20:00 hs y múltiples turnos habilitados).`,
      'success'
    );
  } catch (e) {
    showFeedback(e.message || 'Error al ingresar como profesor.', 'error');
  }
}

// Toggle registration form visibility
const btnShowRegister = document.getElementById('btn-show-register');
if (btnShowRegister) {
  btnShowRegister.addEventListener('click', () => {
    registerForm.classList.toggle('hidden');
    if (!registerForm.classList.contains('hidden')) {
      document.getElementById('nombre').focus();
      btnShowRegister.textContent = 'Ocultar formulario de registro';
    } else {
      btnShowRegister.textContent = 'Registrarme como nuevo jugador';
    }
  });
}

const btnFocusLogin = document.getElementById('btn-focus-login');
if (btnFocusLogin) {
  btnFocusLogin.addEventListener('click', () => {
    const input = document.getElementById('login-mail');
    if (input) {
      input.scrollIntoView({ behavior: 'smooth' });
      input.focus();
    }
  });
}

const btnToggleAuthModal = document.getElementById('btn-toggle-auth-modal');
if (btnToggleAuthModal) {
  btnToggleAuthModal.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar-panel');
    if (sidebar) {
      sidebar.scrollIntoView({ behavior: 'smooth' });
      const firstInput = document.getElementById('login-mail') || document.getElementById('nombre');
      if (firstInput) firstInput.focus();
    }
  });
}

if (btnProfJarno) btnProfJarno.addEventListener('click', () => loginAsProfessor('prof-jarno'));
if (btnProfLeonardo) btnProfLeonardo.addEventListener('click', () => loginAsProfessor('prof-leonardo'));

btnLogout.addEventListener('click', () => {
  currentUser = null;
  localStorage.removeItem('sfca_tenis_user');
  renderProfile();
  renderStatusBanner();
  renderCourts();
});

tabToday.addEventListener('click', () => {
  selectedDayTarget = 'today';
  tabToday.classList.add('active');
  tabTomorrow.classList.remove('active');
  loadBookingsForSelectedDate();
});

tabTomorrow.addEventListener('click', () => {
  selectedDayTarget = 'tomorrow';
  tabTomorrow.classList.add('active');
  tabToday.classList.remove('active');
  loadBookingsForSelectedDate();
});

timeModeSelect.addEventListener('change', e => {
  timeMode = e.target.value;
  updateClockAndLabels();
  loadBookingsForSelectedDate();
});

// Initialize
async function init() {
  updateClockAndLabels();
  setInterval(updateClockAndLabels, 1000);

  const saved = localStorage.getItem('sfca_tenis_user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
    } catch (e) {
      currentUser = null;
    }
  }

  // Render immediately so Cancha 1 and Cancha 2 with all 6 turns are always visible right away
  renderProfile();
  renderStatusBanner();
  renderCourts();

  // Check if backend server is running
  if (window.location.protocol.startsWith('http')) {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const remoteConfig = await res.json();
        if (remoteConfig && Array.isArray(remoteConfig.slots)) {
          config = remoteConfig;
          backendAvailable = true;
        }
      }
    } catch (e) {
      backendAvailable = false;
    }
  }

  await loadBookingsForSelectedDate();
}

init();
