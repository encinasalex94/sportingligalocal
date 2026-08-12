import {
  signInWithGoogle, signOutUser, onAuthChange, currentUser,
  getRoster, getMyPlayerId, getMyAdminStatus, isVotingOpen,
  getSignups, setSignup, getVotes, submitVote,
  getRankingForMatch, getRankingValoraciones,
  getActaById, getScorers,
  getUpcomingCustomMatches, getAllCustomMatches, addCustomMatch, updateCustomMatch, deleteCustomMatch,
  setCustomMatchResult,
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

function formatSignupTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// ---- Amistosos de pretemporada dentro del Calendario del Sporting -------
const ICON_DOC =
  '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 13h6M9 17h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

const ICON_VOTE =
  '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 12.5l2 2 4.5-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/></svg>';

const ICON_STAR =
  '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5l2.6 5.4 5.9.7-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.7L12 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

function customMatchCardHtml(m, isAdmin, loggedIn) {
  const now = Date.now();
  const timePassed = m.timestamp < now;
  const hasResult = m.played && m.homeGoals != null && m.awayGoals != null;
  const key = `${m.season}__${m.round}`;

  let scoreHtml = 'Pendiente';
  let cls = 'is-pending';
  if (hasResult) {
    const ourGoals = m.isHome ? m.homeGoals : m.awayGoals;
    const theirGoals = m.isHome ? m.awayGoals : m.homeGoals;
    scoreHtml = `${ourGoals} - ${theirGoals}`;
    cls = ourGoals > theirGoals ? 'win' : ourGoals < theirGoals ? 'loss' : 'draw';
  } else if (timePassed) {
    scoreHtml = 'Sin resultado';
    cls = 'sin-resultado';
  }

  const addResultBtn = isAdmin && timePassed
    ? `<button class="acta-btn-icon" data-add-result="${key}" title="${hasResult ? 'Editar resultado' : 'Añadir resultado'}" aria-label="Resultado">${ICON_DOC}</button>`
    : '';
  const detailBtn = hasResult && loggedIn && !isAdmin
    ? `<button class="acta-btn-icon" data-detail-custom="${key}" title="Ver ficha" aria-label="Ver ficha">${ICON_DOC}</button>`
    : '';
  const votarBtn = hasResult && loggedIn
    ? `<button class="acta-btn-icon acta-btn-icon-alt" data-votar-custom="${key}" title="Votar" aria-label="Votar">${ICON_VOTE}</button>`
    : '';
  const rankingBtn = hasResult && loggedIn
    ? `<button class="acta-btn-icon" data-ranking-custom="${key}" title="Ranking" aria-label="Ranking">${ICON_STAR}</button>`
    : '';
  const iconRow = (addResultBtn || detailBtn || votarBtn || rankingBtn)
    ? `<div class="acta-icon-row">${addResultBtn}${detailBtn}${votarBtn}${rankingBtn}</div>`
    : '';

  return `
    <div class="calendar-item amistoso ${cls}" data-match-key="${key}">
      <div class="calendar-round">
        <span>Amistoso</span>
        <span class="calendar-venue">${m.isHome ? 'Casa' : 'Fuera'}</span>
      </div>
      <span class="calendar-opponent" title="${m.opponent}">${m.opponent}</span>
      <span class="calendar-score">${scoreHtml}</span>
      <span class="calendar-date">${m.date || ''}${m.time ? ' · ' + m.time : ''}${m.venue ? ' · ' + m.venue : ''}</span>
      ${iconRow}
    </div>
  `;
}

let customMatchesRenderToken = 0;

async function renderCustomMatchesInCalendar() {
  const token = ++customMatchesRenderToken; // esta llamada es la "más nueva" hasta que otra la sustituya
  const list = document.getElementById('calendar-list');
  if (!list) return;

  const viewingPretemporada = window.CURRENT_COMPETITION_TYPE === 'pretemporada';
  if (!viewingPretemporada) {
    list.querySelectorAll('.calendar-item.amistoso').forEach((el) => el.remove());
    return; // el Tipo elegido es Liga o Copa, no toca
  }

  // El calendario de partidos (rivales, fechas) siempre ha sido público —
  // igual que el de la Liga. Lo que sí pide sesión es la Convocatoria
  // (quién va a cada partido), no el propio calendario.

  try {
    const customMatches = await getAllCustomMatches();

    // Si mientras esperábamos esta respuesta se lanzó OTRA llamada más
    // reciente a esta misma función, la descartamos — es la causa de que
    // antes se duplicaran las tarjetas (dos llamadas casi a la vez, cada
    // una borrando e insertando por su cuenta sin saber de la otra).
    if (token !== customMatchesRenderToken) return;

    list.querySelectorAll('.calendar-item.amistoso').forEach((el) => el.remove());

    const summaryEl = document.getElementById('calendar-summary');
    if (!customMatches.length) {
      if (summaryEl) summaryEl.textContent = 'Amistosos de pretemporada · ninguno programado todavía';
      populateCustomRoundSelector([]);
      return;
    }
    if (summaryEl) {
      summaryEl.textContent = `Amistosos de pretemporada · ${customMatches.length} programado${customMatches.length === 1 ? '' : 's'}`;
    }

    const isAdmin = currentUser() ? await getMyAdminStatus() : false;
    const loggedIn = !!window.CLUB_LOGGED_IN;
    if (token !== customMatchesRenderToken) return;

    const html = customMatches.map((m) => customMatchCardHtml(m, isAdmin, loggedIn)).join('');
    list.insertAdjacentHTML('beforeend', html);

    const matchByKey = new Map(customMatches.map((m) => [`${m.season}__${m.round}`, m]));

    list.querySelectorAll('button[data-add-result]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openAddResultModal(matchByKey.get(btn.dataset.addResult));
      });
    });
    list.querySelectorAll('button[data-detail-custom]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openCustomMatchDetail(matchByKey.get(btn.dataset.detailCustom));
      });
    });
    list.querySelectorAll('button[data-votar-custom]').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.openVotarCustom(matchByKey.get(btn.dataset.votarCustom));
      });
    });
    list.querySelectorAll('button[data-ranking-custom]').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.openRankingCustom(matchByKey.get(btn.dataset.rankingCustom));
      });
    });

    populateCustomRoundSelector(customMatches);
    updateHeroForCustomMatches(customMatches);
  } catch (err) {
    console.error('Error cargando amistosos:', err);
  }
}

function dateToInputValue(dateStr) {
  if (!dateStr) return '';
  const [d, mo, y] = dateStr.split('-');
  return `${y}-${mo}-${d}`; // formato YYYY-MM-DD que espera <input type="date">
}

function openEditMatchModal(match) {
  if (!match) return;
  openClubModal(`
    <h3 class="club-modal-title">Editar amistoso</h3>
    <p class="club-modal-sub">Cambia lo que haga falta y guarda.</p>
    <div class="admin-panel-row" style="flex-direction:column; align-items:stretch;">
      <input type="text" id="edit-opponent" placeholder="Rival" class="club-select" value="${match.opponent || ''}" />
      <input type="date" id="edit-date" class="club-select" value="${dateToInputValue(match.date)}" />
      <input type="time" id="edit-time" class="club-select" value="${match.time || ''}" />
      <input type="text" id="edit-venue" placeholder="Campo" class="club-select" value="${match.venue || ''}" />
      <label style="display:flex; align-items:center; gap:8px; font-size:13px;">
        <input type="checkbox" id="edit-ishome" ${match.isHome ? 'checked' : ''} />
        Jugamos en casa
      </label>
    </div>
    <div id="edit-error" class="club-error"></div>
    <button class="acta-btn acta-btn-alt club-submit" id="edit-submit">Guardar cambios</button>
  `);

  document.getElementById('edit-submit').addEventListener('click', async () => {
    const opponent = document.getElementById('edit-opponent').value.trim();
    const dateInput = document.getElementById('edit-date').value;
    const time = document.getElementById('edit-time').value;
    const venue = document.getElementById('edit-venue').value.trim();
    const isHome = document.getElementById('edit-ishome').checked;
    const errorEl = document.getElementById('edit-error');

    if (!opponent) { errorEl.textContent = 'Escribe el nombre del rival.'; return; }
    if (!dateInput) { errorEl.textContent = 'Elige una fecha.'; return; }

    const [y, mo, d] = dateInput.split('-');
    const date = `${d}-${mo}-${y}`;

    try {
      await updateCustomMatch(match.season, match.round, { opponent, date, time, venue, isHome });
      closeClubModal();
      renderConvocatoria();
      renderCustomMatchesInCalendar();
    } catch (err) {
      console.error(err);
      errorEl.textContent = 'No se pudo guardar el cambio.';
    }
  });
}

async function openAddResultModal(match) {
  if (!match) return;
  const roster = await getRoster();
  const playerOptionsHtml = (selectedId) => `
    <option value="">-- jugador --</option>
    ${roster.map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.name}</option>`).join('')}
  `;

  const existingGoals = match.goals || [];
  const existingCards = match.cards || [];

  openClubModal(`
    <h3 class="club-modal-title">Resultado del amistoso</h3>
    <p class="club-modal-sub">vs ${match.opponent} · ${match.date || ''}${match.time ? ' · ' + match.time : ''}</p>
    <div class="admin-panel-row" style="justify-content:center;">
      <span style="font-weight:600;">${match.isHome ? 'Nosotros' : match.opponent}</span>
      <input type="number" min="0" id="result-home" class="club-select" style="width:70px;text-align:center;" value="${match.homeGoals ?? ''}" placeholder="0" />
      <span>-</span>
      <input type="number" min="0" id="result-away" class="club-select" style="width:70px;text-align:center;" value="${match.awayGoals ?? ''}" placeholder="0" />
      <span style="font-weight:600;">${match.isHome ? match.opponent : 'Nosotros'}</span>
    </div>

    <div class="admin-panel-title" style="margin-top:18px;">Goles (nuestros)</div>
    <div id="goals-rows"></div>
    <button class="acta-btn" id="add-goal-row" type="button">+ Añadir gol</button>

    <div class="admin-panel-title" style="margin-top:18px;">Tarjetas</div>
    <div id="cards-rows"></div>
    <button class="acta-btn" id="add-card-row" type="button">+ Añadir tarjeta</button>

    <div id="result-error" class="club-error"></div>
    <button class="acta-btn acta-btn-alt club-submit" id="result-submit">Guardar resultado</button>
  `);

  const goalsContainer = document.getElementById('goals-rows');
  const cardsContainer = document.getElementById('cards-rows');

  function addGoalRow(g) {
    const row = document.createElement('div');
    row.className = 'admin-panel-row goal-row';
    row.innerHTML = `
      <select class="club-select goal-scorer">${playerOptionsHtml(g?.scorerId)}</select>
      <span style="font-size:11px;color:var(--slate);">asist.</span>
      <select class="club-select goal-assist">${playerOptionsHtml(g?.assistId)}</select>
      <input type="number" min="0" class="club-select goal-minute" placeholder="min" style="width:60px;" value="${g?.minute ?? ''}" />
      <button class="acta-btn" type="button" data-remove-row>✕</button>
    `;
    row.querySelector('[data-remove-row]').addEventListener('click', () => row.remove());
    goalsContainer.appendChild(row);
  }

  function addCardRow(c) {
    const row = document.createElement('div');
    row.className = 'admin-panel-row card-row';
    row.innerHTML = `
      <select class="club-select card-player">${playerOptionsHtml(c?.playerId)}</select>
      <select class="club-select card-type">
        <option value="amarilla" ${c?.type === 'amarilla' ? 'selected' : ''}>Amarilla</option>
        <option value="roja" ${c?.type === 'roja' ? 'selected' : ''}>Roja</option>
      </select>
      <input type="number" min="0" class="club-select card-minute" placeholder="min" style="width:60px;" value="${c?.minute ?? ''}" />
      <button class="acta-btn" type="button" data-remove-row>✕</button>
    `;
    row.querySelector('[data-remove-row]').addEventListener('click', () => row.remove());
    cardsContainer.appendChild(row);
  }

  existingGoals.forEach(addGoalRow);
  existingCards.forEach(addCardRow);

  document.getElementById('add-goal-row').addEventListener('click', () => addGoalRow());
  document.getElementById('add-card-row').addEventListener('click', () => addCardRow());

  document.getElementById('result-submit').addEventListener('click', async () => {
    const homeInput = document.getElementById('result-home').value;
    const awayInput = document.getElementById('result-away').value;
    const errorEl = document.getElementById('result-error');
    if (homeInput === '' || awayInput === '') { errorEl.textContent = 'Rellena los dos marcadores.'; return; }

    const byId = new Map(roster.map((p) => [p.id, p.name]));
    const goals = Array.from(goalsContainer.querySelectorAll('.goal-row')).map((row) => {
      const scorerId = row.querySelector('.goal-scorer').value;
      const assistId = row.querySelector('.goal-assist').value;
      const minute = row.querySelector('.goal-minute').value;
      if (!scorerId) return null;
      return {
        scorerId, scorerName: byId.get(scorerId) || scorerId,
        assistId: assistId || null, assistName: assistId ? (byId.get(assistId) || assistId) : null,
        minute: minute ? Number(minute) : null,
      };
    }).filter(Boolean);

    const cards = Array.from(cardsContainer.querySelectorAll('.card-row')).map((row) => {
      const playerId = row.querySelector('.card-player').value;
      const type = row.querySelector('.card-type').value;
      const minute = row.querySelector('.card-minute').value;
      if (!playerId) return null;
      return { playerId, playerName: byId.get(playerId) || playerId, type, minute: minute ? Number(minute) : null };
    }).filter(Boolean);

    try {
      await setCustomMatchResult(match.season, match.round, homeInput, awayInput, goals, cards);
      closeClubModal();
      renderCustomMatchesInCalendar();
    } catch (err) {
      console.error(err);
      errorEl.textContent = 'No se pudo guardar el resultado.';
    }
  });
}

function openCustomMatchDetail(match) {
  if (!match) return;
  const goalsHtml = (match.goals || []).length
    ? `<ul class="acta-goals-list">${match.goals.map((g) => `
        <li>
          <span class="acta-goal-minute">${g.minute != null ? `${g.minute}'` : ''}</span>
          <span>${g.scorerName}${g.assistName ? ` <span style="color:var(--slate-light);">(asist. ${g.assistName})</span>` : ''}</span>
        </li>`).join('')}</ul>`
    : '<p class="acta-empty">Sin goles registrados.</p>';

  const cardsHtml = (match.cards || []).length
    ? `<ul class="acta-goals-list">${match.cards.map((c) => `
        <li>
          <span class="acta-card-dot ${c.type === 'roja' ? 'red' : 'yellow'}"></span>
          <span class="acta-goal-minute">${c.minute != null ? `${c.minute}'` : ''}</span>
          <span>${c.playerName}</span>
        </li>`).join('')}</ul>`
    : '';

  openClubModal(`
    <h3 class="club-modal-title">vs ${match.opponent}</h3>
    <p class="club-modal-sub">${match.date || ''}${match.time ? ' · ' + match.time : ''} · ${match.isHome ? match.homeGoals : match.awayGoals} - ${match.isHome ? match.awayGoals : match.homeGoals}</p>
    <div class="acta-section-title">Goles</div>
    ${goalsHtml}
    ${cardsHtml ? `<div class="acta-section-title">Tarjetas</div>${cardsHtml}` : ''}
  `);
}

// Cuando cambia el selector de Tipo (en app.js), repintamos los amistosos.
window.onCompetitionViewChanged = function onCompetitionViewChanged() {
  renderCustomMatchesInCalendar();
  applySectionVisibility();
};

function getCurrentCustomMatch(customMatches) {
  const now = Date.now();
  const played = customMatches.filter((m) => m.played && m.homeGoals != null && m.awayGoals != null);
  const upcoming = customMatches.filter((m) => m.timestamp > now);
  if (played.length) return played[played.length - 1];
  if (upcoming.length) return upcoming[0];
  return null;
}

// ---- "Resultados de la jornada" para Pretemporada: mismo estilo que Liga --
function renderResultadosForCustomMatch(match, allMatches) {
  const grid = document.getElementById('results-grid');
  const label = document.getElementById('round-label-2');
  if (!grid) return;

  if (!match) {
    grid.innerHTML = '<p class="results-empty">Sin amistosos programados todavía.</p>';
    if (label) label.textContent = '';
    return;
  }

  const idx = allMatches.findIndex((m) => m.season === match.season && m.round === match.round);
  if (label) label.textContent = `Amistoso ${idx + 1} · vs ${match.opponent}${match.date ? ' (' + match.date + ')' : ''}`;

  const hasResult = match.played && match.homeGoals != null && match.awayGoals != null;
  const pending = !hasResult;
  const homeName = match.isHome ? OWN_TEAM_NAME : match.opponent;
  const awayName = match.isHome ? match.opponent : OWN_TEAM_NAME;
  const score = hasResult ? `${match.homeGoals} : ${match.awayGoals}` : 'vs';
  const loggedIn = !!window.CLUB_LOGGED_IN;
  const key = `${match.season}__${match.round}`;

  const metaBits = [];
  if (match.time) metaBits.push(`<span class="meta-chip">${match.time}</span>`);
  if (match.venue) metaBits.push(`<span class="meta-chip">${match.venue}</span>`);
  const metaHtml = metaBits.length ? `<div class="meta-row meta-row-center">${metaBits.join('')}</div>` : '';

  const detailBtn = hasResult && loggedIn
    ? `<div class="acta-btn-wrap"><button class="acta-btn" data-detail-custom-results="${key}">${ICON_DOC}Ver ficha</button></div>` : '';
  const votarBtn = hasResult && loggedIn
    ? `<div class="acta-btn-wrap"><button class="acta-btn acta-btn-alt" data-votar-custom-results="${key}">${ICON_VOTE}Votar</button></div>` : '';
  const rankingBtn = hasResult && loggedIn
    ? `<div class="acta-btn-wrap"><button class="acta-btn acta-btn-ghost" data-ranking-custom-results="${key}">${ICON_STAR}Ranking</button></div>` : '';
  const btnRow = (detailBtn || votarBtn || rankingBtn) ? `<div class="acta-btn-row">${detailBtn}${votarBtn}${rankingBtn}</div>` : '';

  grid.innerHTML = `
    <div class="match-card is-own ${pending ? 'is-pending' : ''}">
      <div class="match-card-row">
        <span class="match-team home ${match.isHome ? 'home-own' : ''}">${shortName(homeName)}</span>
        <span class="match-score ${pending ? 'is-pending' : ''}">${score}</span>
        <span class="match-team away ${!match.isHome ? 'away-own' : ''}">${shortName(awayName)}</span>
      </div>
      ${metaHtml}
      ${btnRow}
    </div>
  `;

  const matchByKey = new Map(allMatches.map((m) => [`${m.season}__${m.round}`, m]));
  grid.querySelectorAll('[data-votar-custom-results]').forEach((btn) => {
    btn.addEventListener('click', () => window.openVotarCustom(matchByKey.get(btn.dataset.votarCustomResults)));
  });
  grid.querySelectorAll('[data-ranking-custom-results]').forEach((btn) => {
    btn.addEventListener('click', () => window.openRankingCustom(matchByKey.get(btn.dataset.rankingCustomResults)));
  });
  grid.querySelectorAll('[data-detail-custom-results]').forEach((btn) => {
    btn.addEventListener('click', () => openCustomMatchDetail(matchByKey.get(btn.dataset.detailCustomResults)));
  });
}

// ---- "Ver jornada" en Pretemporada: lista los amistosos en orden ---------
function populateCustomRoundSelector(customMatches) {
  if (window.CURRENT_COMPETITION_TYPE !== 'pretemporada') return;
  const select = document.getElementById('round-select');
  if (!select) return;

  if (!customMatches.length) {
    select.innerHTML = '<option>—</option>';
    renderResultadosForCustomMatch(null, []);
    return;
  }

  select.innerHTML = customMatches
    .map((m, i) => `<option value="${m.season}__${m.round}">${i + 1}. vs ${m.opponent}${m.date ? ' (' + m.date + ')' : ''}</option>`)
    .join('');

  // Seleccionamos por defecto el partido "actual" (último jugado o el
  // próximo), igual que en el marcador destacado.
  const current = getCurrentCustomMatch(customMatches);
  if (current) select.value = `${current.season}__${current.round}`;
  renderResultadosForCustomMatch(current, customMatches);

  select.onchange = () => {
    const key = select.value;
    const match = customMatches.find((m) => `${m.season}__${m.round}` === key);
    renderResultadosForCustomMatch(match, customMatches);
  };
}

// ---- Marcador destacado en Pretemporada: último amistoso jugado, o si no
// hay ninguno, el próximo programado ---------------------------------------
function updateHeroForCustomMatches(customMatches) {
  if (window.CURRENT_COMPETITION_TYPE !== 'pretemporada') return;

  const heroSection = document.getElementById('scoreboard-hero-section');
  const scoreboardEl = document.getElementById('hero-scoreboard');
  const badgeEl = document.getElementById('hero-result-badge');
  const metaEl = document.getElementById('hero-meta');
  const labelEl = document.getElementById('round-label');
  if (!heroSection || !scoreboardEl) return;

  const now = Date.now();
  const played = customMatches.filter((m) => m.played && m.homeGoals != null && m.awayGoals != null);
  const upcoming = customMatches.filter((m) => m.timestamp > now);

  let match = null;
  let isPlayedView = false;
  if (played.length) {
    match = played[played.length - 1]; // vienen ordenados por fecha ascendente
    isPlayedView = true;
  } else if (upcoming.length) {
    match = upcoming[0];
    isPlayedView = false;
  }

  if (!match) {
    heroSection.style.display = 'none';
    return;
  }
  heroSection.style.display = '';

  const homeName = match.isHome ? OWN_TEAM_NAME : match.opponent;
  const awayName = match.isHome ? match.opponent : OWN_TEAM_NAME;

  if (labelEl) labelEl.textContent = isPlayedView ? 'Último amistoso' : 'Próximo amistoso';

  if (isPlayedView) {
    const ourGoals = match.isHome ? match.homeGoals : match.awayGoals;
    const theirGoals = match.isHome ? match.awayGoals : match.homeGoals;
    const result = ourGoals === theirGoals ? 'EMPATE' : ourGoals > theirGoals ? 'VICTORIA' : 'DERROTA';
    scoreboardEl.innerHTML = `
      <div class="sb-team ${match.isHome ? 'is-own' : ''}"><span class="sb-team-name">${shortName(homeName)}</span></div>
      <div class="sb-score"><span>${match.homeGoals}</span><span class="dash">:</span><span>${match.awayGoals}</span></div>
      <div class="sb-team ${!match.isHome ? 'is-own' : ''}"><span class="sb-team-name">${shortName(awayName)}</span></div>
    `;
    if (badgeEl) badgeEl.innerHTML = `<span class="sb-badge">${result}</span>`;
  } else {
    scoreboardEl.innerHTML = `
      <div class="sb-team ${match.isHome ? 'is-own' : ''}"><span class="sb-team-name">${shortName(homeName)}</span></div>
      <div class="sb-score"><span>-</span><span class="dash">:</span><span>-</span></div>
      <div class="sb-team ${!match.isHome ? 'is-own' : ''}"><span class="sb-team-name">${shortName(awayName)}</span></div>
    `;
    if (badgeEl) badgeEl.innerHTML = `<span class="sb-badge">PRÓXIMO PARTIDO</span>`;
  }

  const metaBits = [];
  if (match.date) metaBits.push(`<span class="meta-chip">${match.date}</span>`);
  if (match.time) metaBits.push(`<span class="meta-chip">${match.time}</span>`);
  if (match.venue) metaBits.push(`<span class="meta-chip">${match.venue}</span>`);
  if (metaEl) metaEl.innerHTML = metaBits.length ? `<div class="meta-row meta-row-center">${metaBits.join('')}</div>` : '';
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
  const loggedIn = !!window.CLUB_LOGGED_IN;
  const viewingLiga = window.CURRENT_COMPETITION_TYPE === 'liga';
  const showGoleadores = loggedIn && viewingLiga;

  toggleSection('convocatoria', 'divider-convocatoria', loggedIn);
  toggleSection('goleadores', 'divider-goleadores', showGoleadores);
  toggleSection('valoraciones', 'divider-valoraciones', loggedIn);
  if (showGoleadores) renderScorers();
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
    renderCustomMatchesInCalendar();
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
  renderCustomMatchesInCalendar();

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
// Recuerda qué paneles "Gestionar convocatoria" estaban abiertos, para que
// no se cierren solos cada vez que se repinta la lista tras un clic
// (si no, apuntar a varias personas seguidas se hace tedioso).
const openAdminPanels = new Set();
const openAttendeeLists = new Set();

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

  // Todos los próximos partidos "reales" (temporada oficial, desde FFMadrid)
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
      date: m.date || m.roundDate, time: m.time, isCustom: false,
      timestamp: parseMatchDateTime(m.date || m.roundDate, m.time)?.getTime() || Infinity,
    }));

  // Todos los amistosos / pretemporada próximos (los añade un delegado a mano)
  const customMatches = await getUpcomingCustomMatches();
  const upcomingCustom = customMatches
    .filter((m) => m.timestamp > now.getTime())
    .map((m) => ({ ...m, isCustom: true }));

  const allUpcoming = [...upcomingReal, ...upcomingCustom].sort((a, b) => a.timestamp - b.timestamp);

  if (allUpcoming.length) {
    sub.textContent = `${allUpcoming.length} próximo${allUpcoming.length === 1 ? '' : 's'} partido${allUpcoming.length === 1 ? '' : 's'}`;
  } else {
    sub.textContent = 'No hay ningún partido próximo programado todavía.';
  }

  const roster = await getRoster();
  // Un bloque de convocatoria por cada partido próximo
  const blocksHtml = await Promise.all(allUpcoming.map(async (match, idx) => {
    const signups = await getSignups(match.season, match.round);
    const signedEntries = roster
      .filter((p) => !!signups[p.id]?.signedUp)
      .map((p) => ({ id: p.id, name: p.name, updatedAt: signups[p.id]?.updatedAt || 0 }))
      .sort((a, b) => a.updatedAt - b.updatedAt); // por orden de inscripción
    const signedIds = signedEntries.map((e) => e.id);
    const iAmSigned = myPlayerId ? signedIds.includes(myPlayerId) : false;
    const key = `${match.season}__${match.round}`;

    const titleLabel = match.isCustom ? 'Amistoso' : `Jornada ${match.round}`;

    const deleteBtnHtml = admin && match.isCustom
      ? `<button class="acta-btn" data-delete-match="${key}">Borrar este amistoso</button>`
      : '';
    const editBtnHtml = admin && match.isCustom
      ? `<button class="acta-btn" data-edit-match="${key}">Editar amistoso</button>`
      : '';

    const signedListInnerHtml = signedEntries.length
      ? `<ol class="convocatoria-count-list">${signedEntries
          .map((e) => `<li class="${e.id === myPlayerId ? 'is-me' : ''}">${e.name}${e.id === myPlayerId ? ' <span class="convocatoria-me-tag">(tú)</span>' : ''}${e.updatedAt ? ` <span class="convocatoria-time">${formatSignupTime(e.updatedAt)}</span>` : ''}</li>`)
          .join('')}</ol>`
      : '<p class="acta-empty">Todavía no se ha apuntado nadie.</p>';

    const signedListHtml = `
      <details class="attendee-panel" data-attendee-key="${key}" ${openAttendeeLists.has(key) ? 'open' : ''}>
        <summary class="admin-panel-title convocatoria-summary-toggle">${signedIds.length} apuntado${signedIds.length === 1 ? '' : 's'}</summary>
        ${signedListInnerHtml}
      </details>
    `;

    // Aviso bien visible si el propio jugador todavía no se ha apuntado.
    const notSignedWarningHtml = myPlayerId && !iAmSigned
      ? `<div class="convocatoria-warning"><svg class="warning-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5L22 20.5H2L12 3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1" fill="currentColor"/></svg> Todavía no estás apuntado a este partido</div>`
      : '';

    const myOwnButtonHtml = myPlayerId
      ? `
        <div class="convocatoria-own-row">
          <button class="acta-btn ${iAmSigned ? 'acta-btn-alt' : ''} club-submit" data-my-signup="${key}" data-signed="${iAmSigned}">
            ${iAmSigned ? 'Voy ✓ (pulsa para quitarte)' : 'Apuntarme'}
          </button>
        </div>
      `
      : '';

    const adminManageHtml = admin
      ? `
        <details class="admin-panel" data-match-key="${key}" ${openAdminPanels.has(key) ? 'open' : ''}>
          <summary class="admin-panel-title">Gestionar convocatoria (delegado)</summary>
          <ul class="convocatoria-list">
            ${roster.map((p) => {
              const signed = signedIds.includes(p.id);
              return `
                <li class="convocatoria-item ${signed ? 'is-signed' : ''}">
                  <span>${p.name}</span>
                  <button class="acta-btn ${signed ? 'acta-btn-alt' : ''}" data-player="${p.id}" data-match="${key}" data-signed="${signed}">
                    ${signed ? 'Voy ✓' : 'Apuntar'}
                  </button>
                </li>
              `;
            }).join('')}
          </ul>
        </details>
      `
      : '';

    return `
      <div class="convocatoria-match-block">
        <h3 class="convocatoria-match-title">${titleLabel} · vs ${match.opponent}</h3>
        <p class="convocatoria-match-date">${match.date || ''}${match.time ? ' · ' + match.time : ''}${match.venue ? ' · ' + match.venue : ''}</p>
        <div style="display:flex; gap:8px; margin-bottom:14px;">${editBtnHtml}${deleteBtnHtml}</div>
        ${notSignedWarningHtml}
        ${signedListHtml}
        ${myOwnButtonHtml}
        ${adminManageHtml}
      </div>
    `;
  }));

  const adminPanelHtml = admin ? `
    <div class="admin-panel">
      <div class="admin-panel-title">Añadir partido de pretemporada (solo delegados)</div>
      <div class="admin-panel-row">
        <input type="text" id="custom-opponent" placeholder="Rival" class="club-select" style="flex:2;" />
        <input type="date" id="custom-date" class="club-select" style="flex:1;" />
        <input type="time" id="custom-time" class="club-select" style="flex:1;" />
        <input type="text" id="custom-venue" placeholder="Campo" class="club-select" style="flex:1;" />
        <button class="acta-btn acta-btn-alt" id="custom-add-btn">Añadir</button>
      </div>
      <div id="custom-add-error" class="club-error"></div>
    </div>
  ` : '';

  content.innerHTML = `${blocksHtml.join('<div class="divider" style="margin:22px 0;"></div>')}${allUpcoming.length ? '<div class="divider" style="margin:22px 0;"></div>' : ''}${adminPanelHtml}`;

  content.querySelectorAll('details.admin-panel[data-match-key]').forEach((el) => {
    el.addEventListener('toggle', () => {
      const key = el.dataset.matchKey;
      if (el.open) openAdminPanels.add(key);
      else openAdminPanels.delete(key);
    });
  });

  content.querySelectorAll('details.admin-panel[data-attendee-key]').forEach((el) => {
    el.addEventListener('toggle', () => {
      const key = el.dataset.attendeeKey;
      if (el.open) openAttendeeLists.add(key);
      else openAttendeeLists.delete(key);
    });
  });

  // Índice rápido: de la "clave" (season__round) a los datos del partido
  const matchByKey = new Map(allUpcoming.map((m) => [`${m.season}__${m.round}`, m]));

  content.querySelectorAll('button[data-my-signup]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const match = matchByKey.get(btn.dataset.mySignup);
      const currentlySigned = btn.dataset.signed === 'true';
      btn.disabled = true;
      try {
        await setSignup(match.season, match.round, myPlayerId, !currentlySigned);
        renderConvocatoria();
      } catch (err) {
        console.error(err);
        alert('No se pudo guardar, inténtalo de nuevo.');
        btn.disabled = false;
      }
    });
  });

  content.querySelectorAll('button[data-player]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const match = matchByKey.get(btn.dataset.match);
      const playerId = btn.dataset.player;
      const currentlySigned = btn.dataset.signed === 'true';
      btn.disabled = true;
      try {
        await setSignup(match.season, match.round, playerId, !currentlySigned);
        renderConvocatoria();
      } catch (err) {
        console.error(err);
        alert(err.message === 'No autorizado' ? 'Solo el propio jugador o un delegado pueden confirmar esto.' : 'No se pudo guardar, inténtalo de nuevo.');
        btn.disabled = false;
      }
    });
  });

  content.querySelectorAll('button[data-delete-match]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const match = matchByKey.get(btn.dataset.deleteMatch);
      if (!confirm('¿Borrar este amistoso y su convocatoria?')) return;
      try {
        await deleteCustomMatch(match.season, match.round);
        renderConvocatoria();
        renderCustomMatchesInCalendar();
      } catch (err) {
        console.error(err);
        alert('No se pudo borrar.');
      }
    });
  });

  content.querySelectorAll('button[data-edit-match]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openEditMatchModal(matchByKey.get(btn.dataset.editMatch));
    });
  });

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
    const venue = document.getElementById('custom-venue').value.trim();
    const errorEl = document.getElementById('custom-add-error');

    if (!opponent) { errorEl.textContent = 'Escribe el nombre del rival.'; return; }
    if (!dateInput) { errorEl.textContent = 'Elige una fecha.'; return; }

    const [y, mo, d] = dateInput.split('-');
    const date = `${d}-${mo}-${y}`; // formato DD-MM-YYYY, igual que el resto de la web

    addBtn.disabled = true;
    try {
      await addCustomMatch({ opponent, date, time, venue });
      renderConvocatoria();
      renderCustomMatchesInCalendar();
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

// ---- VOTAR / RANKING en amistosos de pretemporada ---------------------------------------------------
window.openVotarCustom = async function openVotarCustom(match) {
  if (!match) return;

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

  openClubModal('<p class="acta-empty" style="text-align:center;">Cargando…</p>');

  const open = await isVotingOpen(match.season, match.round);
  if (!open) {
    openClubModal(`
      <h3 class="club-modal-title">Votación cerrada</h3>
      <p class="club-modal-sub" style="margin-bottom:0;">Ya han pasado más de 24 horas desde el inicio de este partido, así que la votación está cerrada.</p>
    `);
    return;
  }

  const existingVotes = await getVotes(match.season, match.round);
  const alreadyVoted = existingVotes.some((v) => v.voterId === myPlayerId);
  if (alreadyVoted) {
    openClubModal(`
      <h3 class="club-modal-title">Ya has votado</h3>
      <p class="club-modal-sub" style="margin-bottom:0;">Ya registramos tu valoración para este partido. Solo se puede votar una vez por partido.</p>
    `);
    return;
  }

  // En amistosos no hay acta oficial — los convocados salen solo de la
  // convocatoria registrada en la propia web.
  const signups = await getSignups(match.season, match.round);
  const signedIds = Object.keys(signups).filter((id) => signups[id]?.signedUp);
  if (!signedIds.length) {
    openClubModal('<p class="acta-empty" style="text-align:center;padding:20px 0;">No hay convocados registrados para este amistoso.</p>');
    return;
  }
  const roster = await getRoster();
  const byId = new Map(roster.map((p) => [p.id, p.name]));
  const players = signedIds.map((id) => ({ id, name: byId.get(id) || id }));

  openClubModal(`
    <h3 class="club-modal-title">Pon nota del 0 al 10</h3>
    <p class="club-modal-sub">Amistoso vs ${match.opponent}. Puedes usar decimales. Deja en blanco a quien no quieras valorar.</p>
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
        await submitVote(match.season, match.round, ratedId, rating);
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

window.openRankingCustom = async function openRankingCustom(match) {
  if (!match) return;
  openClubModal('<p class="acta-empty" style="text-align:center;">Cargando…</p>');
  try {
    const ranking = await getRankingForMatch(match.season, match.round);
    if (!ranking.length) {
      openClubModal(`
        <h3 class="club-modal-title">vs ${match.opponent}</h3>
        <p class="acta-empty" style="text-align:center;padding:10px 0;">Todavía no hay valoraciones para este amistoso.</p>
      `);
      return;
    }
    const mvp = ranking[0];
    openClubModal(`
      <h3 class="club-modal-title">MVP · vs ${match.opponent}</h3>
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
    `);
  } catch (err) {
    console.error('Error cargando ranking del amistoso:', err);
    openClubModal(`<p class="acta-empty" style="text-align:center;padding:20px 0;">No se pudo cargar el ranking (${err.message || 'error'}).</p>`);
  }
};


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
