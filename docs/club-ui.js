import {
  signInWithGoogle, signOutUser, onAuthChange, currentUser,
  getRoster, getMyPlayerId, getMyAdminStatus, isVotingOpen,
  getSignups, setSignup, getVotes, submitVote,
  getRankingForMatch, getRankingValoraciones,
  getActaById, getScorers,
  getUpcomingCustomMatches, addCustomMatch, deleteCustomMatch,
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

function scorerListItemHtml(s) {
  return `
    <li class="${s.isOwnTeam ? 'is-own' : ''}">
      <div class="scorer-name">
        <span class="scorer-player">${s.player}</span>
        <span class="scorer-team">${s.team}${s.penalties ? ` · ${s.penalties} de penalti` : ''}</span>
      </div>
      <span class="scorer-goals">${s.goals}</span>
    </li>
  `;
}

async function renderScorers() {
  const ownEl = document.getElementById('own-scorers');
  const topEl = document.getElementById('top-scorers');
  if (!ownEl || !topEl) return;
  if (!window.CLUB_LOGGED_IN) return; // sección oculta, no hace falta pintar

  try {
    const { topScorers, ownTeamScorers } = await getScorers();
    ownEl.innerHTML = ownTeamScorers && ownTeamScorers.length
      ? ownTeamScorers.map(scorerListItemHtml).join('')
      : '<li class="sb-empty" style="padding:14px;">Todavía no hay goleadores registrados.</li>';
    topEl.innerHTML = topScorers && topScorers.length
      ? topScorers.map(scorerListItemHtml).join('')
      : '<li class="sb-empty" style="padding:14px;">Todavía no hay goleadores registrados.</li>';
  } catch (err) {
    console.error('Error cargando goleadores:', err);
    ownEl.innerHTML = `<li class="sb-empty" style="padding:14px;">No se pudieron cargar (${err.message || 'error'}).</li>`;
    topEl.innerHTML = '';
  }
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
  if (show) renderScorers();
}

function shortName(name) {
  return (name || '').trim();
}

function playerListHtml(players) {
  if (!players || !players.length) return '<p class="acta-empty">Sin datos</p>';
  return `<ul class="acta-player-list">${players
    .map((p) => `<li><span class="acta-player-number">${p.number || ''}</span><span>${p.name}</span></li>`)
    .join('')}</ul>`;
}

function teamActaHtml(team) {
  if (!team) return '<p class="acta-empty">Sin datos de este equipo</p>';
  return `
    <div class="acta-lineup-team">${team.teamName}</div>
    <div class="acta-lineup-label">Titulares</div>
    ${playerListHtml(team.titulares)}
    ${team.suplentes && team.suplentes.length ? `<div class="acta-lineup-label">Suplentes</div>${playerListHtml(team.suplentes)}` : ''}
    ${team.entrenador && !/no presenta/i.test(team.entrenador) ? `<div class="acta-lineup-label">Entrenador</div><p style="font-size:12.5px;margin:0;">${team.entrenador}</p>` : ''}
  `;
}

// ---- VER ACTA (lee de Firestore, requiere sesión) ---------------------------------
window.openActa = async function openActa(codActa) {
  const overlay = document.getElementById('acta-overlay');
  const content = document.getElementById('acta-content');

  if (!currentUser()) {
    content.innerHTML = '<p class="acta-empty" style="text-align:center;padding:20px 0;">Inicia sesión para ver la ficha del partido.</p>';
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    return;
  }

  content.innerHTML = '<p class="acta-empty" style="text-align:center;">Cargando…</p>';
  overlay.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  let acta;
  try {
    acta = await getActaById(codActa);
  } catch (err) {
    console.error('Error cargando acta:', err);
    content.innerHTML = `<p class="acta-empty" style="text-align:center;padding:20px 0;">No se pudo cargar la ficha (${err.message || 'error'}).</p>`;
    return;
  }

  if (!acta) {
    content.innerHTML = '<p class="acta-empty" style="text-align:center;padding:20px 0;">Ficha no disponible todavía para este partido.</p>';
    return;
  }

  const homeTeamName = acta.homeTeam;
  const awayTeamName = acta.awayTeam;
  const homeIsOwn = isOwn(homeTeamName);
  const awayIsOwn = isOwn(awayTeamName);

  const finalScore = acta.goals && acta.goals.length
    ? acta.goals[acta.goals.length - 1]
    : { homeScore: acta.homeGoals, awayScore: acta.awayGoals };

  const metaBits = [];
  if (acta.date) metaBits.push(acta.date);
  if (acta.time) metaBits.push(`${acta.time} h`);
  metaBits.push(`Jornada ${acta.round}`);

  const goalsHtml = acta.goals && acta.goals.length
    ? `<ul class="acta-goals-list">${acta.goals
        .map(
          (g) => `
        <li>
          <span class="acta-goal-score">${g.homeScore}-${g.awayScore}</span>
          <span class="acta-goal-minute">${g.minute != null ? `${g.minute}'` : ''}</span>
          <span>${g.scorer}${g.penalty ? ' (penalti)' : ''}${g.ownGoal ? ' (propia puerta)' : ''}</span>
        </li>`
        )
        .join('')}</ul>`
    : '<p class="acta-empty">Sin goles registrados</p>';

  content.innerHTML = `
    <div class="acta-header">
      <div class="acta-header-meta">${metaBits.join(' · ')}</div>
      <div class="acta-header-score">
        <span class="acta-team-name home ${homeIsOwn ? 'is-own' : ''}">${shortName(homeTeamName)}</span>
        <span class="score-box">${finalScore.homeScore} : ${finalScore.awayScore}</span>
        <span class="acta-team-name away ${awayIsOwn ? 'is-own' : ''}">${shortName(awayTeamName)}</span>
      </div>
      ${acta.referees && acta.referees.length ? `<div class="acta-referee">Árbitro: ${acta.referees.join(', ')}</div>` : ''}
    </div>

    <div class="acta-section-title">Goles</div>
    ${goalsHtml}

    <div class="acta-section-title">Alineaciones</div>
    <div class="acta-lineups">
      <div>${teamActaHtml(acta.home)}</div>
      <div>${teamActaHtml(acta.away)}</div>
    </div>
  `;
};

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
let myPlayerIdCache = null;

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

  myPlayerIdCache = await getMyPlayerId();

  widget.innerHTML = `
    <span class="auth-user">
      ${user.photoURL ? `<img src="${user.photoURL}" class="auth-avatar" alt="" />` : ''}
      <span class="auth-user-name">${myPlayerIdCache ? await playerNameById(myPlayerIdCache) : 'Cuenta no autorizada'}</span>
    </span>
    <button class="auth-btn" id="logout-btn">Cerrar sesión</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', () => signOutUser());

  // Solo consideramos "sesión activa" (para mostrar convocatoria/votar/
  // ranking/goleadores) si tu email está en la lista autorizada del club.
  window.CLUB_LOGGED_IN = !!myPlayerIdCache;
  applySectionVisibility();
  window.rerenderClubDependentUI && window.rerenderClubDependentUI();

  if (!myPlayerIdCache) {
    openClubModal(`
      <h3 class="club-modal-title">Cuenta no autorizada</h3>
      <p class="club-modal-sub" style="margin-bottom:0;">Tu cuenta de Google (${user.email}) todavía no está en la lista de jugadores del club. Pide a un delegado que la añada.</p>
    `);
  }
}

async function playerNameById(playerId) {
  const roster = await getRoster();
  const found = roster.find((p) => p.id === playerId);
  return found ? found.name : playerId;
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

  const myPlayerId = currentUser() ? await getMyPlayerId() : null;
  const admin = myPlayerId ? await getMyAdminStatus() : false;

  const now = new Date();

  // Próximo partido "real" (temporada oficial, desde FFMadrid)
  const upcomingReal = (data.rounds || [])
    .flatMap((r) => r.matches.map((m) => ({ ...m, round: r.round, roundDate: r.date })))
    .filter((m) => isOwn(m.homeTeam) || isOwn(m.awayTeam))
    .filter((m) => !m.played)
    .filter((m) => {
      const dt = parseMatchDateTime(m.date || m.roundDate, m.time);
      return !dt || dt > now;
    })
    .map((m) => ({
      season: SEASON, round: m.round,
      opponent: isOwn(m.homeTeam) ? m.awayTeam : m.homeTeam,
      date: m.date, time: m.time, isCustom: false,
      timestamp: parseMatchDateTime(m.date || m.roundDate, m.time)?.getTime() || Infinity,
    }));

  // Amistosos / pretemporada (los añade un delegado a mano)
  const customMatches = await getUpcomingCustomMatches();
  const upcomingCustom = customMatches
    .filter((m) => m.timestamp > now.getTime())
    .map((m) => ({ ...m, isCustom: true }));

  const allUpcoming = [...upcomingReal, ...upcomingCustom].sort((a, b) => a.timestamp - b.timestamp);

  // Panel de admin: crear un amistoso nuevo (siempre visible para el admin,
  // aunque ya haya un próximo partido, para poder ir añadiendo varios)
  const adminPanelHtml = admin ? `
    <div class="admin-panel">
      <div class="admin-panel-title">Añadir partido de pretemporada (solo delegados)</div>
      <div class="admin-panel-row">
        <input type="text" id="custom-opponent" placeholder="Rival" class="club-select" style="flex:2;" />
        <input type="date" id="custom-date" class="club-select" style="flex:1;" />
        <input type="time" id="custom-time" class="club-select" style="flex:1;" />
        <button class="acta-btn acta-btn-alt" id="custom-add-btn">Añadir</button>
      </div>
      <div id="custom-add-error" class="club-error"></div>
    </div>
  ` : '';

  if (!allUpcoming.length) {
    sub.textContent = 'No hay ningún partido próximo programado todavía.';
    content.innerHTML = adminPanelHtml;
    wireAdminPanel(admin);
    return;
  }

  const next = allUpcoming[0];
  sub.textContent = `${next.isCustom ? 'Amistoso' : `Jornada ${next.round}`} · vs ${next.opponent} · ${next.date || ''}${next.time ? ' · ' + next.time : ''}`;

  const roster = await getRoster();
  const signups = await getSignups(next.season, next.round);
  const nameById = new Map(roster.map((p) => [p.id, p.name]));

  const signedIds = roster.map((p) => p.id).filter((id) => !!signups[id]?.signedUp);
  const iAmSigned = myPlayerId ? signedIds.includes(myPlayerId) : false;

  const deleteBtnHtml = admin && next.isCustom
    ? `<button class="acta-btn" id="custom-delete-btn" style="margin-bottom:14px;">Borrar este amistoso</button>`
    : '';

  // Lista numerada de quién va, solo informativa (sin botones)
  const signedListHtml = signedIds.length
    ? `<ol class="convocatoria-count-list">${signedIds
        .map((id) => `<li>${nameById.get(id) || id}</li>`)
        .join('')}</ol>`
    : '<p class="acta-empty">Todavía no se ha apuntado nadie.</p>';

  // Tu propio botón (el único que ve un jugador normal)
  const myOwnButtonHtml = myPlayerId
    ? `
      <div class="convocatoria-own-row">
        <button class="acta-btn ${iAmSigned ? 'acta-btn-alt' : ''} club-submit" id="my-signup-btn" data-signed="${iAmSigned}">
          ${iAmSigned ? 'Voy ✓ (pulsa para quitarte)' : 'Apuntarme'}
        </button>
      </div>
    `
    : '';

  // Panel de gestión para delegados: pueden apuntar/quitar a cualquiera
  const adminManageHtml = admin
    ? `
      <div class="admin-panel">
        <div class="admin-panel-title">Gestionar convocatoria (delegado)</div>
        <ul class="convocatoria-list">
          ${roster.map((p) => {
            const signed = signedIds.includes(p.id);
            return `
              <li class="convocatoria-item ${signed ? 'is-signed' : ''}">
                <span>${p.name}</span>
                <button class="acta-btn ${signed ? 'acta-btn-alt' : ''}" data-player="${p.id}" data-signed="${signed}">
                  ${signed ? 'Voy ✓' : 'Apuntar'}
                </button>
              </li>
            `;
          }).join('')}
        </ul>
      </div>
    `
    : '';

  content.innerHTML = `
    ${deleteBtnHtml}
    <div class="convocatoria-summary">${signedIds.length} apuntado${signedIds.length === 1 ? '' : 's'}</div>
    ${signedListHtml}
    ${myOwnButtonHtml}
    ${adminManageHtml}
    ${adminPanelHtml}
  `;

  const myBtn = document.getElementById('my-signup-btn');
  if (myBtn) {
    myBtn.addEventListener('click', async () => {
      const currentlySigned = myBtn.dataset.signed === 'true';
      myBtn.disabled = true;
      try {
        await setSignup(next.season, next.round, myPlayerId, !currentlySigned);
        renderConvocatoria();
      } catch (err) {
        console.error(err);
        alert('No se pudo guardar, inténtalo de nuevo.');
        myBtn.disabled = false;
      }
    });
  }

  content.querySelectorAll('button[data-player]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = btn.dataset.player;
      const currentlySigned = btn.dataset.signed === 'true';
      btn.disabled = true;
      try {
        await setSignup(next.season, next.round, playerId, !currentlySigned);
        renderConvocatoria();
      } catch (err) {
        console.error(err);
        alert(err.message === 'No autorizado' ? 'Solo el propio jugador o un delegado pueden confirmar esto.' : 'No se pudo guardar, inténtalo de nuevo.');
        btn.disabled = false;
      }
    });
  });

  const deleteBtn = document.getElementById('custom-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este amistoso y su convocatoria?')) return;
      try {
        await deleteCustomMatch(next.season, next.round);
        renderConvocatoria();
      } catch (err) {
        console.error(err);
        alert('No se pudo borrar.');
      }
    });
  }

  wireAdminPanel(admin);
}

function wireAdminPanel(admin) {
  if (!admin) return;
  const addBtn = document.getElementById('custom-add-btn');
  if (!addBtn) return;
  addBtn.addEventListener('click', async () => {
    const opponent = document.getElementById('custom-opponent').value.trim();
    const dateInput = document.getElementById('custom-date').value; // YYYY-MM-DD
    const time = document.getElementById('custom-time').value; // HH:MM
    const errorEl = document.getElementById('custom-add-error');

    if (!opponent) { errorEl.textContent = 'Escribe el nombre del rival.'; return; }
    if (!dateInput) { errorEl.textContent = 'Elige una fecha.'; return; }

    const [y, mo, d] = dateInput.split('-');
    const date = `${d}-${mo}-${y}`; // formato DD-MM-YYYY, igual que el resto de la web

    addBtn.disabled = true;
    try {
      await addCustomMatch({ opponent, date, time });
      renderConvocatoria();
    } catch (err) {
      console.error(err);
      errorEl.textContent = 'No se pudo añadir el partido.';
      addBtn.disabled = false;
    }
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

  const myPlayerId = await getMyPlayerId();
  if (!myPlayerId) {
    openClubModal(`<p class="acta-empty" style="text-align:center;padding:20px 0;">Tu cuenta todavía no está autorizada. Pide a un delegado que la añada.</p>`);
    return;
  }

  const roundData = (data.rounds || []).find((r) => r.round === round);
  const match = roundData && roundData.matches.find((m) => isOwn(m.homeTeam) || isOwn(m.awayTeam));
  if (!match) return;

  openClubModal('<p class="acta-empty" style="text-align:center;">Cargando…</p>');

  const open = await isVotingOpen(SEASON, round);
  if (!open) {
    openClubModal(`
      <h3 class="club-modal-title">Votación cerrada</h3>
      <p class="club-modal-sub" style="margin-bottom:0;">Ya han pasado más de 24 horas desde el inicio de este partido, así que la votación está cerrada.</p>
    `);
    return;
  }

  const existingVotes = await getVotes(SEASON, round);
  const alreadyVoted = existingVotes.some((v) => v.voterId === myPlayerId);
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
