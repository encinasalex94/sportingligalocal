import {
  signInWithGoogle, signOutUser, onAuthChange, currentUser,
  getRoster, getMyLink, createLink, getMyAdminStatus,
  getSignups, setSignup, getVotes, submitVote,
  getRankingForMatch, getRankingValoraciones,
} from './firebase-club.js';

const SEASON = '2025-2026';
const OWN_TEAM_NAME = 'SPORTING DE MADERASA - BAR JUANJO';

function isOwn(name) {
  return (name || '').toUpperCase().includes(OWN_TEAM_NAME);
}

function parseMatchDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const [d, m, y] = dateStr.split('-').map(Number);
  let h = 0, min = 0;
  if (timeStr) {
    const parts = timeStr.split(':').map(Number);
    h = parts[0] || 0;
    min = parts[1] || 0;
  }
  return new Date(y, m - 1, d, h, min);
}

function toggleSection(sectionId, dividerId, show) {
  const section = document.getElementById(sectionId);
  const divider = dividerId ? document.getElementById(dividerId) : null;
  if (section) section.style.display = show ? '' : 'none';
  if (divider) divider.style.display = show ? '' : 'none';
}

function applySectionVisibility() {
  const show = !!window.CLUB_LOGGED_IN;
  toggleSection('convocatoria', 'divider-convocatoria', show);
  toggleSection('goleadores', 'divider-goleadores', show);
  toggleSection('valoraciones', 'divider-valoraciones', show);
}

// ---- Modal genérico -------------------------------------------------
function openClubModal(html) {
  document.getElementById('club-content').innerHTML = html;
  document.getElementById('club-overlay').classList.add('is-open');
  document.body.style.overflow = 'hidden';
}
function closeClubModal() {
  document.getElementById('club-overlay').classList.remove('is-open');
  document.body.style.overflow = '';
}
window.closeClubModalGlobal = closeClubModal;

// ---- Barra de sesión (login con Google) ------------------------------
let myLinkCache = null;

async function renderAuthWidget() {
  const widget = document.getElementById('auth-widget');
  if (!widget) return;
  const user = currentUser();

  if (!user) {
    window.CLUB_LOGGED_IN = false;
    widget.innerHTML = `<button class="auth-btn" id="login-btn">Iniciar sesión</button>`;
    document.getElementById('login-btn').addEventListener('click', async () => {
      try {
        await signInWithGoogle();
      } catch (err) {
        console.error('Error de login:', err);
      }
    });
    applySectionVisibility();
    window.rerenderClubDependentUI && window.rerenderClubDependentUI();
    return;
  }

  myLinkCache = await getMyLink();
  const displayName = myLinkCache ? null : user.displayName;

  widget.innerHTML = `
    <span class="auth-user">
      ${user.photoURL ? `<img src="${user.photoURL}" class="auth-avatar" alt="" />` : ''}
      <span class="auth-user-name">${myLinkCache ? await playerNameById(myLinkCache.playerId) : (displayName || user.email)}</span>
    </span>
    <button class="auth-btn" id="logout-btn">Cerrar sesión</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', () => signOutUser());

  // Solo consideramos "sesión activa" (para mostrar votar/ranking) una vez
  // que la cuenta ya está vinculada a un jugador de la plantilla.
  window.CLUB_LOGGED_IN = !!myLinkCache;
  applySectionVisibility();
  window.rerenderClubDependentUI && window.rerenderClubDependentUI();

  if (!myLinkCache) {
    promptLinkAccount();
  }
}

async function playerNameById(playerId) {
  const roster = await getRoster();
  const found = roster.find((p) => p.id === playerId);
  return found ? found.name : playerId;
}

async function promptLinkAccount() {
  const roster = await getRoster();
  const options = roster.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  openClubModal(`
    <h3 class="club-modal-title">¿Quién eres?</h3>
    <p class="club-modal-sub">Es la primera vez que entras. Elige tu nombre para vincular tu cuenta (solo se hace una vez).</p>
    <select id="link-select" class="club-select">
      <option value="">-- Selecciona tu nombre --</option>
      ${options}
    </select>
    <div id="link-error" class="club-error"></div>
    <button class="acta-btn acta-btn-alt club-submit" id="link-submit">Confirmar</button>
  `);
  document.getElementById('link-submit').addEventListener('click', async () => {
    const playerId = document.getElementById('link-select').value;
    const errorEl = document.getElementById('link-error');
    if (!playerId) { errorEl.textContent = 'Selecciona tu nombre.'; return; }
    try {
      await createLink(playerId);
      closeClubModal();
      renderAuthWidget();
    } catch (err) {
      console.error(err);
      errorEl.textContent = 'No se pudo vincular tu cuenta. Inténtalo de nuevo.';
    }
  });
}

// ---- CONVOCATORIA ---------------------------------------------------
async function renderConvocatoria() {
  const data = window.APP_DATA;
  const sub = document.getElementById('convocatoria-sub');
  const content = document.getElementById('convocatoria-content');
  if (!data) return;

  if (!window.CLUB_LOGGED_IN) {
    // La sección entera está oculta (ver applySectionVisibility), no hace
    // falta pintar nada.
    return;
  }

  const now = new Date();
  const upcoming = (data.rounds || [])
    .flatMap((r) => r.matches.map((m) => ({ ...m, round: r.round, roundDate: r.date })))
    .filter((m) => isOwn(m.homeTeam) || isOwn(m.awayTeam))
    .filter((m) => !m.played)
    .filter((m) => {
      const dt = parseMatchDateTime(m.date || m.roundDate, m.time);
      return !dt || dt > now;
    })
    .sort((a, b) => (a.round || 0) - (b.round || 0));

  if (!upcoming.length) {
    sub.textContent = 'No hay ningún partido próximo programado todavía.';
    content.innerHTML = '';
    return;
  }

  const next = upcoming[0];
  const opponent = isOwn(next.homeTeam) ? next.awayTeam : next.homeTeam;
  sub.textContent = `Jornada ${next.round} · vs ${opponent} · ${next.date || ''}${next.time ? ' · ' + next.time : ''}`;

  const roster = await getRoster();
  const signups = await getSignups(SEASON, next.round);
  const link = currentUser() ? await getMyLink() : null;
  const admin = link ? await getMyAdminStatus() : false;

  content.innerHTML = `
    <ul class="convocatoria-list">
      ${roster.map((p) => {
        const signed = !!signups[p.id]?.signedUp;
        const canToggle = link && (link.playerId === p.id || admin);
        return `
          <li class="convocatoria-item ${signed ? 'is-signed' : ''}">
            <span>${p.name}</span>
            <button class="acta-btn ${signed ? 'acta-btn-alt' : ''}" data-player="${p.id}" data-signed="${signed}" ${canToggle ? '' : 'disabled title="Inicia sesión para confirmarte a ti mismo (o pide a un delegado)"'}>
              ${signed ? 'Voy ✓' : 'Apuntarme'}
            </button>
          </li>
        `;
      }).join('')}
    </ul>
  `;

  content.querySelectorAll('button[data-player]:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = btn.dataset.player;
      const currentlySigned = btn.dataset.signed === 'true';
      btn.disabled = true;
      try {
        await setSignup(SEASON, next.round, playerId, !currentlySigned);
        renderConvocatoria();
      } catch (err) {
        console.error(err);
        alert(err.message === 'No autorizado' ? 'Solo el propio jugador o un delegado pueden confirmar esto.' : 'No se pudo guardar, inténtalo de nuevo.');
        btn.disabled = false;
      }
    });
  });
}

// ---- VOTAR ---------------------------------------------------
window.openVotar = async function openVotar(round) {
  const data = window.APP_DATA;
  if (!data) return;

  if (!currentUser()) {
    openClubModal(`
      <h3 class="club-modal-title">Inicia sesión</h3>
      <p class="club-modal-sub" style="margin-bottom:0;">Para votar necesitas iniciar sesión con Google (botón arriba a la derecha).</p>
    `);
    return;
  }

  const link = await getMyLink();
  if (!link) {
    openClubModal(`<p class="acta-empty" style="text-align:center;padding:20px 0;">Termina de vincular tu cuenta primero.</p>`);
    return;
  }

  const roundData = (data.rounds || []).find((r) => r.round === round);
  const match = roundData && roundData.matches.find((m) => isOwn(m.homeTeam) || isOwn(m.awayTeam));
  if (!match) return;

  openClubModal('<p class="acta-empty" style="text-align:center;">Cargando…</p>');

  const existingVotes = await getVotes(SEASON, round);
  const alreadyVoted = existingVotes.some((v) => v.voterId === link.playerId);
  if (alreadyVoted) {
    openClubModal(`
      <h3 class="club-modal-title">Ya has votado</h3>
      <p class="club-modal-sub" style="margin-bottom:0;">Ya registramos tu valoración para este partido. Solo se puede votar una vez por partido.</p>
    `);
    return;
  }

  // Convocados: preferimos la convocatoria real si existe; si no (partidos
  // de antes de tener este sistema), usamos la alineación del acta.
  let players = [];
  try {
    const signups = await getSignups(SEASON, round);
    const signedIds = Object.keys(signups).filter((id) => signups[id]?.signedUp);
    if (signedIds.length) {
      const roster = await getRoster();
      const byId = new Map(roster.map((p) => [p.id, p.name]));
      players = signedIds.map((id) => ({ id, name: byId.get(id) || id }));
    }
  } catch (err) { /* seguimos con el fallback */ }

  if (!players.length && match.acta) {
    const ownSide = isOwn(match.homeTeam) ? match.acta.home : match.acta.away;
    if (ownSide) {
      const roster = await getRoster();
      const byName = new Map(roster.map((p) => [p.name.toUpperCase(), p]));
      const all = [...(ownSide.titulares || []), ...(ownSide.suplentes || [])];
      players = all
        .map((pl) => byName.get(pl.name.toUpperCase()))
        .filter(Boolean)
        .map((p) => ({ id: p.id, name: p.name }));
    }
  }

  if (!players.length) {
    openClubModal('<p class="acta-empty" style="text-align:center;padding:20px 0;">No hay convocados registrados para este partido todavía.</p>');
    return;
  }

  openClubModal(`
    <h3 class="club-modal-title">Pon nota del 0 al 10</h3>
    <p class="club-modal-sub">Jornada ${round}. Puedes usar decimales (ej. 6,75). Deja en blanco a quien no quieras valorar.</p>
    <ul class="vote-list">
      ${players.map((p) => `
        <li class="vote-item">
          <span>${p.name}</span>
          <input type="number" min="0" max="10" step="0.01" class="vote-input" data-player="${p.id}" placeholder="-" />
        </li>
      `).join('')}
    </ul>
    <div id="vote-error" class="club-error"></div>
    <button class="acta-btn acta-btn-alt club-submit" id="vote-submit">Enviar valoraciones</button>
  `);

  document.getElementById('vote-submit').addEventListener('click', async () => {
    const errorEl = document.getElementById('vote-error');
    const submitBtn = document.getElementById('vote-submit');
    const inputs = Array.from(document.querySelectorAll('.vote-input')).filter((i) => i.value !== '');

    if (!inputs.length) { errorEl.textContent = 'Pon al menos una nota.'; return; }
    const invalid = inputs.some((i) => Number(i.value) < 0 || Number(i.value) > 10);
    if (invalid) { errorEl.textContent = 'Las notas deben estar entre 0 y 10.'; return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando…';
    try {
      for (const input of inputs) {
        const ratedId = input.dataset.player;
        const rating = Number(input.value);
        await submitVote(SEASON, round, ratedId, rating);
      }
      openClubModal(`
        <h3 class="club-modal-title">¡Gracias! ✓</h3>
        <p class="club-modal-sub" style="margin-bottom:0;">Tu valoración se ha guardado correctamente (${inputs.length} jugador${inputs.length === 1 ? '' : 'es'} puntuado${inputs.length === 1 ? '' : 's'}).</p>
      `);
      renderRanking();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar valoraciones';
      console.error(err);
      errorEl.textContent = 'No se pudo guardar, inténtalo de nuevo.';
    }
  });
};

// ---- RANKING DE UN PARTIDO (MVP de la jornada) ---------------------------------------------------
window.openRanking = async function openRanking(round) {
  openClubModal('<p class="acta-empty" style="text-align:center;">Cargando…</p>');
  try {
    const ranking = await getRankingForMatch(SEASON, round);
    if (!ranking.length) {
      openClubModal(`
        <h3 class="club-modal-title">Jornada ${round}</h3>
        <p class="acta-empty" style="text-align:center;padding:10px 0;">Todavía no hay valoraciones para este partido.</p>
        <p style="text-align:center;"><a href="#valoraciones" class="acta-btn acta-btn-ghost" onclick="window.closeClubModalGlobal && window.closeClubModalGlobal()">Ver ranking general de la temporada</a></p>
      `);
      return;
    }

    const mvp = ranking[0];
    openClubModal(`
      <h3 class="club-modal-title">MVP de la jornada ${round}</h3>
      <div class="mvp-highlight">
        <span class="mvp-name">${mvp.name}</span>
        <span class="mvp-score">${mvp.average.toFixed(2)}</span>
      </div>
      <ul class="vote-list" style="margin-top:18px;">
        ${ranking.map((r, i) => `
          <li class="vote-item">
            <span>${i + 1}. ${r.name}</span>
            <span class="scorer-goals" style="font-size:14px;">${r.average.toFixed(2)}</span>
          </li>
        `).join('')}
      </ul>
      <p style="text-align:center;margin-top:16px;"><a href="#valoraciones" class="acta-btn acta-btn-ghost" onclick="window.closeClubModalGlobal && window.closeClubModalGlobal()">Ver ranking general de la temporada</a></p>
    `);
  } catch (err) {
    console.error('Error cargando ranking del partido:', err);
    openClubModal(`<p class="acta-empty" style="text-align:center;padding:20px 0;">No se pudo cargar el ranking (${err.message || 'error'}).</p>`);
  }
};

// ---- RANKING GENERAL ---------------------------------------------------
async function renderRanking() {
  const list = document.getElementById('valoraciones-list');
  if (!list) return;

  if (!window.CLUB_LOGGED_IN) {
    // La sección entera está oculta (ver applySectionVisibility).
    return;
  }

  try {
    const ranking = await getRankingValoraciones();
    if (!ranking.length) {
      list.innerHTML = '<li class="sb-empty" style="padding:14px;">Todavía no hay valoraciones registradas.</li>';
      return;
    }
    list.innerHTML = ranking
      .map((r) => `
        <li>
          <div class="scorer-name">
            <span class="scorer-player">${r.name}</span>
            <span class="scorer-team">${r.votes} valoración${r.votes === 1 ? '' : 'es'}</span>
          </div>
          <span class="scorer-goals">${r.average.toFixed(2)}</span>
        </li>
      `)
      .join('');
  } catch (err) {
    console.error('Error cargando ranking:', err);
    list.innerHTML = `<li class="sb-empty" style="padding:14px;">No se pudieron cargar las valoraciones (${err.message || err.code || 'error desconocido'}).</li>`;
  }
}

// ---- init ---------------------------------------------------
document.getElementById('club-close')?.addEventListener('click', closeClubModal);
document.getElementById('club-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'club-overlay') closeClubModal();
});

onAuthChange(async () => {
  await renderAuthWidget();
  renderConvocatoria();
  renderRanking();
});

async function init() {
  await renderAuthWidget();
  renderConvocatoria();
  renderRanking();
}

if (window.APP_DATA) {
  init();
} else {
  document.addEventListener('app-data-ready', init, { once: true });
}
