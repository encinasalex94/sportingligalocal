import {
  getRoster, getSignups, setSignup, getVotes, submitVote, getRankingValoraciones, verifyVoter,
} from './firebase-club.js';

const SEASON = '2025-2026';
const OWN_TEAM_NAME = 'SPORTING DE MADERASA - BAR JUANJO';

function isOwn(name) {
  return (name || '').toUpperCase().includes(OWN_TEAM_NAME);
}

function parseMatchDateTime(dateStr, timeStr) {
  // dateStr formato DD-MM-YYYY, timeStr formato HH:MM
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

// ---- Modal genérico (nombre + PIN) --------------------------------------
function openClubModal(html) {
  document.getElementById('club-content').innerHTML = html;
  document.getElementById('club-overlay').classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeClubModal() {
  document.getElementById('club-overlay').classList.remove('is-open');
  document.body.style.overflow = '';
}

async function rosterSelectHtml(id) {
  const roster = await getRoster();
  const options = roster.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  return `<select id="${id}" class="club-select"><option value="">-- Selecciona tu nombre --</option>${options}</select>`;
}

// ---- CONVOCATORIA ---------------------------------------------------
async function renderConvocatoria() {
  const data = window.APP_DATA;
  const sub = document.getElementById('convocatoria-sub');
  const content = document.getElementById('convocatoria-content');
  if (!data) return;

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

  content.innerHTML = `
    <ul class="convocatoria-list">
      ${roster.map((p) => {
        const signed = !!signups[p.id]?.signedUp;
        return `
          <li class="convocatoria-item ${signed ? 'is-signed' : ''}">
            <span>${p.name}</span>
            <button class="acta-btn ${signed ? 'acta-btn-alt' : ''}" data-player="${p.id}" data-round="${next.round}" data-signed="${signed}">
              ${signed ? 'Voy ✓' : 'Apuntarme'}
            </button>
          </li>
        `;
      }).join('')}
    </ul>
  `;

  content.querySelectorAll('button[data-player]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const playerId = btn.dataset.player;
      const round = Number(btn.dataset.round);
      const currentlySigned = btn.dataset.signed === 'true';
      openSignupPinModal(playerId, round, !currentlySigned);
    });
  });
}

async function openSignupPinModal(playerId, round, wantSignedUp) {
  const rosterSelect = await rosterSelectHtml('signup-voter');
  openClubModal(`
    <h3 class="club-modal-title">${wantSignedUp ? 'Apuntar al partido' : 'Quitar de la convocatoria'}</h3>
    <p class="club-modal-sub">¿Quién confirma esto? (tú mismo, o un delegado del equipo)</p>
    ${rosterSelect}
    <input type="password" inputmode="numeric" maxlength="6" id="signup-pin" class="club-pin-input" placeholder="Tu PIN" />
    <div id="signup-error" class="club-error"></div>
    <button class="acta-btn acta-btn-alt club-submit" id="signup-submit">Confirmar</button>
  `);

  // Preseleccionamos automáticamente al propio jugador, para el caso normal
  // de que cada uno se apunte a sí mismo (un admin puede cambiarlo).
  const voterSelect = document.getElementById('signup-voter');
  if (voterSelect) voterSelect.value = playerId;

  document.getElementById('signup-submit').addEventListener('click', async () => {
    const voterId = document.getElementById('signup-voter').value;
    const pin = document.getElementById('signup-pin').value.trim();
    const errorEl = document.getElementById('signup-error');
    if (!voterId) { errorEl.textContent = 'Selecciona quién confirma.'; return; }
    if (!/^\d{6}$/.test(pin)) {
      errorEl.textContent = 'El PIN debe tener 6 dígitos.';
      return;
    }
    try {
      await setSignup(SEASON, round, playerId, voterId, pin, wantSignedUp);
      closeClubModal();
      renderConvocatoria();
    } catch (err) {
      const msg = err.message === 'PIN incorrecto' ? 'PIN incorrecto.'
        : err.message === 'No autorizado' ? 'Solo el propio jugador o un delegado pueden confirmar esto.'
        : 'No se pudo guardar, inténtalo de nuevo.';
      errorEl.textContent = msg;
    }
  });
}

// ---- VOTAR ---------------------------------------------------
window.openVotar = async function openVotar(round) {
  const data = window.APP_DATA;
  if (!data) return;

  const roundData = (data.rounds || []).find((r) => r.round === round);
  const match = roundData && roundData.matches.find((m) => isOwn(m.homeTeam) || isOwn(m.awayTeam));
  if (!match) return;

  // ---- Paso 1: identificarse ----
  const rosterSelect = await rosterSelectHtml('vote-voter');
  openClubModal(`
    <h3 class="club-modal-title">Vota este partido</h3>
    <p class="club-modal-sub">Jornada ${round}. Primero dinos quién eres.</p>
    ${rosterSelect}
    <input type="password" inputmode="numeric" maxlength="6" id="vote-pin" class="club-pin-input" placeholder="Tu PIN" style="margin-top:10px;" />
    <div id="vote-error" class="club-error"></div>
    <button class="acta-btn acta-btn-alt club-submit" id="vote-step1-submit">Continuar</button>
  `);

  document.getElementById('vote-step1-submit').addEventListener('click', async () => {
    const voterId = document.getElementById('vote-voter').value;
    const pin = document.getElementById('vote-pin').value.trim();
    const errorEl = document.getElementById('vote-error');

    if (!voterId) { errorEl.textContent = 'Selecciona tu nombre.'; return; }
    if (!/^\d{6}$/.test(pin)) { errorEl.textContent = 'El PIN debe tener 6 dígitos.'; return; }

    errorEl.textContent = '';
    const { ok } = await verifyVoter(voterId, pin);
    if (!ok) { errorEl.textContent = 'PIN incorrecto.'; return; }

    // ¿Ya ha votado este partido? No se puede votar dos veces.
    const existingVotes = await getVotes(SEASON, round);
    const alreadyVoted = existingVotes.some((v) => v.voterId === voterId);
    if (alreadyVoted) {
      openClubModal(`
        <h3 class="club-modal-title">Ya has votado</h3>
        <p class="club-modal-sub" style="margin-bottom:0;">Ya registramos tu valoración para este partido. Solo se puede votar una vez por partido.</p>
      `);
      return;
    }

    await showVoteForm(round, match, voterId, pin);
  });
};

async function showVoteForm(round, match, voterId, pin) {
  openClubModal('<p class="acta-empty" style="text-align:center;">Cargando convocados…</p>');

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
      // Cruzamos por nombre (los nombres del acta y de la plantilla usan el mismo formato "APELLIDOS, NOMBRE")
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
    <p class="club-modal-sub">Puedes usar decimales (ej. 6,75). Deja en blanco a quien no quieras valorar.</p>
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
        await submitVote(SEASON, round, voterId, pin, ratedId, rating);
      }
      openClubModal(`
        <h3 class="club-modal-title">¡Gracias! ✓</h3>
        <p class="club-modal-sub" style="margin-bottom:0;">Tu valoración se ha guardado correctamente (${inputs.length} jugador${inputs.length === 1 ? '' : 'es'} puntuado${inputs.length === 1 ? '' : 's'}).</p>
      `);
      renderRanking();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar valoraciones';
      errorEl.textContent = err.message === 'PIN incorrecto' ? 'PIN incorrecto.' : 'No se pudo guardar, inténtalo de nuevo.';
    }
  });
}

// ---- RANKING ---------------------------------------------------
async function renderRanking() {
  const list = document.getElementById('valoraciones-list');
  if (!list) return;
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
    list.innerHTML = '<li class="sb-empty" style="padding:14px;">No se pudieron cargar las valoraciones.</li>';
  }
}

// ---- init ---------------------------------------------------
document.getElementById('club-close')?.addEventListener('click', closeClubModal);
document.getElementById('club-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'club-overlay') closeClubModal();
});

function init() {
  renderConvocatoria();
  renderRanking();
}

if (window.APP_DATA) {
  init();
} else {
  document.addEventListener('app-data-ready', init, { once: true });
}
