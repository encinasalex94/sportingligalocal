import {
  signInWithGoogle, signOutUser, onAuthChange, currentUser,
  getRoster, getMyPlayerId, getMyAdminStatus, isVotingOpen,
  getAttendance, setAttendance, getVotes, submitVote,
  getRankingForMatch, getPlayerSeasonStats,
  getActaById, getScorers, updateActa,
  getUpcomingCustomMatches, getAllCustomMatches, addCustomMatch, updateCustomMatch, deleteCustomMatch,
  setCustomMatchResult,
} from './firebase-club.js';

const SEASON = '2026-2027';
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

const ICON_EDIT =
  '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const ICON_TRASH =
  '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICON_ATTENDANCE =
  '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M15 12l2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function customMatchCardHtml(m, isAdmin, loggedIn) {
  const now = Date.now();
  const timePassed = m.timestamp < now;
  const within24h = timePassed && (now - m.timestamp) < 24 * 60 * 60 * 1000;
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

  const editBtn = isAdmin
    ? `<button class="acta-btn-icon" data-edit-match="${key}" title="Editar amistoso" aria-label="Editar">${ICON_EDIT}</button>`
    : '';
  const deleteBtn = isAdmin
    ? `<button class="acta-btn-icon" data-delete-match="${key}" title="Borrar amistoso" aria-label="Borrar">${ICON_TRASH}</button>`
    : '';
  const attendanceBtn = isAdmin && timePassed
    ? `<button class="acta-btn-icon" data-attendance-custom="${key}" title="Marcar asistencia" aria-label="Asistencia">${ICON_ATTENDANCE}</button>`
    : '';
  const addResultBtn = isAdmin && timePassed
    ? `<button class="acta-btn-icon" data-add-result="${key}" title="${hasResult ? 'Editar resultado' : 'Añadir resultado'}" aria-label="Resultado">${ICON_DOC}</button>`
    : '';
  const detailBtn = hasResult && !isAdmin
    ? `<button class="acta-btn-icon" data-detail-custom="${key}" title="Ver ficha" aria-label="Ver ficha">${ICON_DOC}</button>`
    : '';
  const votarBtn = within24h && loggedIn
    ? `<button class="acta-btn-icon acta-btn-icon-alt" data-votar-custom="${key}" title="Votar" aria-label="Votar">${ICON_VOTE}</button>`
    : '';
  const rankingBtn = hasResult
    ? `<button class="acta-btn-icon" data-ranking-custom="${key}" title="Ranking" aria-label="Ranking">${ICON_STAR}</button>`
    : '';
  const iconRow = (editBtn || deleteBtn || attendanceBtn || addResultBtn || detailBtn || votarBtn || rankingBtn)
    ? `<div class="acta-icon-row">${editBtn}${deleteBtn}${attendanceBtn}${addResultBtn}${detailBtn}${votarBtn}${rankingBtn}</div>`
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
    const adminActionsEl = document.getElementById('calendar-admin-actions');
    if (adminActionsEl) adminActionsEl.innerHTML = '';
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

    const isAdmin = currentUser() ? await getMyAdminStatus() : false;
    const loggedIn = !!window.CLUB_LOGGED_IN;
    if (token !== customMatchesRenderToken) return;

    const adminActionsEl = document.getElementById('calendar-admin-actions');
    if (adminActionsEl) {
      adminActionsEl.innerHTML = isAdmin
        ? `<div class="acta-btn-wrap" style="margin-bottom:16px;"><button class="acta-btn acta-btn-alt" id="open-add-match-modal">+ Añadir partido de pretemporada</button></div>`
        : '';
      const openBtn = document.getElementById('open-add-match-modal');
      if (openBtn) openBtn.addEventListener('click', openAddMatchModal);
    }

    const summaryEl = document.getElementById('calendar-summary');
    if (!customMatches.length) {
      if (summaryEl) summaryEl.textContent = 'Amistosos de pretemporada · ninguno programado todavía';
      populateCustomRoundSelector([]);
      return;
    }
    if (summaryEl) {
      summaryEl.textContent = `Amistosos de pretemporada · ${customMatches.length} programado${customMatches.length === 1 ? '' : 's'}`;
    }

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
    list.querySelectorAll('button[data-edit-match]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openEditMatchModal(matchByKey.get(btn.dataset.editMatch));
      });
    });
    list.querySelectorAll('button[data-delete-match]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const match = matchByKey.get(btn.dataset.deleteMatch);
        if (!confirm('¿Borrar este amistoso?')) return;
        try {
          await deleteCustomMatch(match.season, match.round);
          renderCustomMatchesInCalendar();
        } catch (err) {
          console.error(err);
          alert('No se pudo borrar.');
        }
      });
    });
    list.querySelectorAll('button[data-attendance-custom]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openAttendanceModalCustom(matchByKey.get(btn.dataset.attendanceCustom));
      });
    });

    populateCustomRoundSelector(customMatches);
    updateHeroForCustomMatches(customMatches);
  } catch (err) {
    console.error('Error cargando amistosos:', err);
  }
}

function attachDateAutoFormat(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) formatted = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
    else if (digits.length > 2) formatted = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    input.value = formatted;
  });
}

function attachTimeAutoFormat(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    let formatted = digits;
    if (digits.length > 2) formatted = `${digits.slice(0, 2)}:${digits.slice(2)}`;
    input.value = formatted;
  });
}

async function openAttendanceModalGeneric(season, round, subtitle) {
  const roster = await getRoster();
  let existing = [];
  try {
    existing = (await getAttendance(season, round)) || [];
  } catch (err) { /* nada marcado todavía */ }

  openClubModal(`
    <h3 class="club-modal-title">Marcar asistencia</h3>
    <p class="club-modal-sub">${subtitle}</p>
    <ul class="convocatoria-list">
      ${roster.map((p) => `
        <li class="convocatoria-item ${existing.includes(p.id) ? 'is-signed' : ''}">
          <span>${p.name}</span>
          <input type="checkbox" class="attendance-check" data-player="${p.id}" ${existing.includes(p.id) ? 'checked' : ''} />
        </li>
      `).join('')}
    </ul>
    <div id="attendance-error" class="club-error"></div>
    <button class="acta-btn acta-btn-alt club-submit" id="attendance-submit">Guardar asistencia</button>
  `);

  document.getElementById('attendance-submit').addEventListener('click', async () => {
    const checked = Array.from(document.querySelectorAll('.attendance-check:checked')).map((el) => el.dataset.player);
    const errorEl = document.getElementById('attendance-error');
    try {
      await setAttendance(season, round, checked);
      closeClubModal();
    } catch (err) {
      console.error(err);
      errorEl.textContent = 'No se pudo guardar la asistencia.';
    }
  });
}

function openAttendanceModalCustom(match) {
  if (!match) return;
  openAttendanceModalGeneric(match.season, match.round, `vs ${match.opponent} · ${match.date || ''}`);
}

window.openAttendanceModal = function openAttendanceModal(round) {
  const data = window.APP_DATA;
  if (!data) return;
  const roundData = (data.rounds || []).find((r) => r.round === round);
  const match = roundData && roundData.matches.find((m) => isOwn(m.homeTeam) || isOwn(m.awayTeam));
  const opponent = match ? (isOwn(match.homeTeam) ? match.awayTeam : match.homeTeam) : '';
  openAttendanceModalGeneric(SEASON, round, `vs ${opponent} · Jornada ${round}`);
};

function openEditMatchModal(match) {
  if (!match) return;
  openClubModal(`
    <h3 class="club-modal-title">Editar amistoso</h3>
    <p class="club-modal-sub">Cambia lo que haga falta y guarda.</p>
    <div class="field-group">
      <label class="field-label">Rival</label>
      <input type="text" id="edit-opponent" class="club-select" value="${match.opponent || ''}" />
    </div>
    <div class="field-group">
      <label class="field-label">Fecha (DD-MM-AAAA)</label>
      <input type="text" id="edit-date" class="club-select" inputmode="numeric" placeholder="ej. 20-08-2026" value="${match.date || ''}" />
    </div>
    <div class="field-group">
      <label class="field-label">Hora (HH:MM)</label>
      <input type="text" id="edit-time" class="club-select" inputmode="numeric" placeholder="ej. 19:00" value="${match.time || ''}" />
    </div>
    <div class="field-group">
      <label class="field-label">Campo</label>
      <input type="text" id="edit-venue" class="club-select" value="${match.venue || ''}" />
    </div>
    <label style="display:flex; align-items:center; gap:8px; font-size:13px; margin-top:6px;">
      <input type="checkbox" id="edit-ishome" ${match.isHome ? 'checked' : ''} />
      Jugamos en casa
    </label>
    <div id="edit-error" class="club-error"></div>
    <button class="acta-btn acta-btn-alt club-submit" id="edit-submit">Guardar cambios</button>
  `);

  attachDateAutoFormat(document.getElementById('edit-date'));
  attachTimeAutoFormat(document.getElementById('edit-time'));

  document.getElementById('edit-submit').addEventListener('click', async () => {
    const opponent = document.getElementById('edit-opponent').value.trim();
    const date = document.getElementById('edit-date').value.trim();
    const time = document.getElementById('edit-time').value.trim();
    const venue = document.getElementById('edit-venue').value.trim();
    const isHome = document.getElementById('edit-ishome').checked;
    const errorEl = document.getElementById('edit-error');

    if (!opponent) { errorEl.textContent = 'Escribe el nombre del rival.'; return; }
    if (!/^\d{2}-\d{2}-\d{4}$/.test(date)) { errorEl.textContent = 'La fecha debe tener el formato DD-MM-AAAA.'; return; }
    if (time && !/^\d{1,2}:\d{2}$/.test(time)) { errorEl.textContent = 'La hora debe tener el formato HH:MM.'; return; }

    try {
      await updateCustomMatch(match.season, match.round, { opponent, date, time, venue, isHome });
      closeClubModal();
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

  // Si ya se ha marcado la asistencia, priorizamos esa lista (más corta y
  // relevante); si no, mostramos toda la plantilla.
  let players = roster;
  try {
    const attendance = await getAttendance(match.season, match.round);
    if (attendance && attendance.length) {
      const byId = new Map(roster.map((p) => [p.id, p.name]));
      players = attendance.map((id) => ({ id, name: byId.get(id) || id }));
    }
  } catch (err) { /* usamos toda la plantilla */ }

  // Estado en memoria mientras se rellena el acta: por jugador, sus goles
  // (cada uno con minuto y asistencia opcional) y tarjetas.
  const state = new Map(players.map((p) => [p.id, { goals: [], card: null }]));
  (match.goals || []).forEach((g) => {
    if (state.has(g.scorerId)) state.get(g.scorerId).goals.push({ minute: g.minute, assistId: g.assistId || null });
  });
  (match.cards || []).forEach((c) => {
    if (state.has(c.playerId)) state.get(c.playerId).card = { type: c.type, minute: c.minute };
  });

  const byId = new Map(roster.map((p) => [p.id, p.name]));

  function playerRowHtml(p) {
    const entry = state.get(p.id);
    const goalsTags = entry.goals
      .map((g, i) => `
        <span class="player-goal-tag" data-player="${p.id}" data-goal-idx="${i}">
          ⚽ ${g.minute != null ? g.minute + "'" : ''}${g.assistId ? ` (asist. ${shortName(byId.get(g.assistId) || '')})` : ''}
          <button type="button" data-remove-goal="${p.id}" data-idx="${i}">✕</button>
        </span>
      `).join('');
    const cardTag = entry.card
      ? `<span class="player-card-tag ${entry.card.type === 'roja' ? 'red' : 'yellow'}">
          ${entry.card.type === 'roja' ? '🟥' : '🟨'} ${entry.card.minute != null ? entry.card.minute + "'" : ''}
          <button type="button" data-remove-card="${p.id}">✕</button>
        </span>`
      : '';

    return `
      <li class="player-result-row" data-player-row="${p.id}">
        <span class="player-result-name">${p.name}</span>
        <span class="player-result-tags">${goalsTags}${cardTag}</span>
        <span class="player-result-actions">
          <button type="button" class="acta-btn" data-add-goal="${p.id}">⚽ Gol</button>
          <button type="button" class="acta-btn" data-add-yellow="${p.id}">🟨</button>
          <button type="button" class="acta-btn" data-add-red="${p.id}">🟥</button>
        </span>
      </li>
    `;
  }

  function renderPlayerList() {
    const list = document.getElementById('players-result-list');
    if (list) list.innerHTML = players.map(playerRowHtml).join('');
    wirePlayerRows();
  }

  function wirePlayerRows() {
    document.querySelectorAll('[data-add-goal]').forEach((btn) => {
      btn.addEventListener('click', () => openMiniGoalForm(btn.dataset.addGoal));
    });
    document.querySelectorAll('[data-add-yellow]').forEach((btn) => {
      btn.addEventListener('click', () => { state.get(btn.dataset.addYellow).card = { type: 'amarilla', minute: null }; renderPlayerList(); });
    });
    document.querySelectorAll('[data-add-red]').forEach((btn) => {
      btn.addEventListener('click', () => { state.get(btn.dataset.addRed).card = { type: 'roja', minute: null }; renderPlayerList(); });
    });
    document.querySelectorAll('[data-remove-goal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.get(btn.dataset.removeGoal).goals.splice(Number(btn.dataset.idx), 1);
        renderPlayerList();
      });
    });
    document.querySelectorAll('[data-remove-card]').forEach((btn) => {
      btn.addEventListener('click', () => { state.get(btn.dataset.removeCard).card = null; renderPlayerList(); });
    });
  }

  function openMiniGoalForm(scorerId) {
    const assistOptions = players.filter((p) => p.id !== scorerId);
    openClubModal(`
      <h3 class="club-modal-title">Gol de ${byId.get(scorerId)}</h3>
      <div class="field-group">
        <label class="field-label">Minuto (opcional)</label>
        <input type="number" min="0" id="mini-goal-minute" class="club-select" placeholder="ej. 35" />
      </div>
      <div class="field-group">
        <label class="field-label">Asistencia (opcional)</label>
        <select id="mini-goal-assist" class="club-select">
          <option value="">-- sin asistencia --</option>
          ${assistOptions.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </div>
      <button class="acta-btn acta-btn-alt club-submit" id="mini-goal-save">Añadir gol</button>
    `);
    document.getElementById('mini-goal-save').addEventListener('click', () => {
      const minute = document.getElementById('mini-goal-minute').value;
      const assistId = document.getElementById('mini-goal-assist').value || null;
      state.get(scorerId).goals.push({ minute: minute ? Number(minute) : null, assistId });
      reopenMainModal();
    });
  }

  function reopenMainModal() {
    openMainModal();
  }

  function openMainModal() {
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

      <div class="admin-panel-title" style="margin-top:18px;">Goles y tarjetas — toca un jugador</div>
      <ul id="players-result-list" class="player-result-list"></ul>

      <div id="result-error" class="club-error"></div>
      <button class="acta-btn acta-btn-alt club-submit" id="result-submit">Guardar resultado</button>
    `);
    renderPlayerList();

    document.getElementById('result-submit').addEventListener('click', async () => {
      const homeInput = document.getElementById('result-home').value;
      const awayInput = document.getElementById('result-away').value;
      const errorEl = document.getElementById('result-error');
      if (homeInput === '' || awayInput === '') { errorEl.textContent = 'Rellena los dos marcadores.'; return; }

      const goals = [];
      const cards = [];
      state.forEach((entry, playerId) => {
        entry.goals.forEach((g) => {
          goals.push({
            scorerId: playerId, scorerName: byId.get(playerId) || playerId,
            assistId: g.assistId, assistName: g.assistId ? (byId.get(g.assistId) || g.assistId) : null,
            minute: g.minute,
          });
        });
        if (entry.card) {
          cards.push({ playerId, playerName: byId.get(playerId) || playerId, type: entry.card.type, minute: entry.card.minute });
        }
      });

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

  openMainModal();
}

async function openCustomMatchDetail(match) {
  if (!match) return;
  openClubModal('<p class="acta-empty" style="text-align:center;">Cargando…</p>');

  const admin = await getMyAdminStatus();
  const homeName = match.isHome ? OWN_TEAM_NAME : match.opponent;
  const awayName = match.isHome ? match.opponent : OWN_TEAM_NAME;

  const metaBits = [];
  if (match.date) metaBits.push(match.date);
  if (match.time) metaBits.push(`${match.time} h`);
  if (match.venue) metaBits.push(match.venue);

  const goalsHtml = (match.goals || []).length
    ? `<ul class="acta-goals-list">${match.goals.map((g) => `
        <li>
          <span class="acta-goal-minute">${g.minute != null ? `${g.minute}'` : ''}</span>
          <span>⚽ ${g.scorerName}${g.assistName ? ` <span style="color:var(--slate-light);">(asist. ${g.assistName})</span>` : ''}</span>
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

  const editBtnHtml = admin
    ? `<p style="text-align:center;margin-top:18px;"><button class="acta-btn" id="edit-from-detail">Editar ficha</button></p>`
    : '';

  openClubModal(`
    <div class="acta-header">
      <div class="acta-header-meta">${metaBits.join(' · ')}</div>
      <div class="acta-header-score">
        <span class="acta-team-name home ${match.isHome ? 'is-own' : ''}">${shortName(homeName)}</span>
        <span class="score-box">${match.homeGoals} : ${match.awayGoals}</span>
        <span class="acta-team-name away ${!match.isHome ? 'is-own' : ''}">${shortName(awayName)}</span>
      </div>
    </div>
    <div class="acta-section-title">Goles</div>
    ${goalsHtml}
    ${cardsHtml ? `<div class="acta-section-title">Tarjetas</div>${cardsHtml}` : ''}
    ${editBtnHtml}
  `);

  const editBtn = document.getElementById('edit-from-detail');
  if (editBtn) {
    editBtn.addEventListener('click', () => openAddResultModal(match));
  }
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
  const now = Date.now();
  const within24h = match.timestamp < now && (now - match.timestamp) < 24 * 60 * 60 * 1000;

  const metaBits = [];
  if (match.time) metaBits.push(`<span class="meta-chip">${match.time}</span>`);
  if (match.venue) metaBits.push(`<span class="meta-chip">${match.venue}</span>`);
  const metaHtml = metaBits.length ? `<div class="meta-row meta-row-center">${metaBits.join('')}</div>` : '';

  const detailBtn = hasResult
    ? `<div class="acta-btn-wrap"><button class="acta-btn" data-detail-custom-results="${key}">${ICON_DOC}Ver ficha</button></div>` : '';
  const votarBtn = within24h && loggedIn
    ? `<div class="acta-btn-wrap"><button class="acta-btn acta-btn-alt" data-votar-custom-results="${key}">${ICON_VOTE}Votar</button></div>` : '';
  const rankingBtn = hasResult
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
  const viewingLiga = window.CURRENT_COMPETITION_TYPE === 'liga';
  const showGoleadores = viewingLiga; // público, ya no depende de sesión

  toggleSection('goleadores', 'divider-goleadores', showGoleadores);
  toggleSection('estadisticas', 'divider-estadisticas', showGoleadores);
  if (showGoleadores) {
    renderScorers();
    renderPlayerStats();
  }
}

// Los nombres de la plantilla vienen como "APELLIDO1 APELLIDO2, NOMBRE1
// NOMBRE2" — en esta tabla, para que quepa mejor, solo el primer apellido
// y el primer nombre.
function shortPlayerName(fullName) {
  if (!fullName) return '';
  const [surnames, givenNames] = fullName.split(',').map((s) => (s || '').trim());
  const firstSurname = (surnames || '').split(' ')[0] || '';
  const firstGivenName = (givenNames || '').split(' ')[0] || '';
  return firstGivenName ? `${firstSurname}, ${firstGivenName}` : firstSurname;
}

async function renderPlayerStats() {
  const body = document.getElementById('stats-table-body');
  const sub = document.getElementById('estadisticas-sub');
  if (!body) return;

  const data = window.APP_DATA;
  if (!data) return;

  const jornadasDisputadas = (data.ownTeamCalendar || []).filter((m) => m.played).length;
  if (sub) sub.textContent = `Temporada ${data.season || ''} · ${jornadasDisputadas} jornada${jornadasDisputadas === 1 ? '' : 's'} disputada${jornadasDisputadas === 1 ? '' : 's'}`;

  // Puntos que sacó el EQUIPO en cada jornada (3 ganado, 1 empatado, 0
  // perdido) — para el "Puntos por Jornada" de cada jugador, que refleja
  // cómo le fue al equipo en los partidos que él disputó.
  const teamPointsByRound = {};
  (data.ownTeamCalendar || []).forEach((m) => {
    if (!m.played) return;
    teamPointsByRound[m.round] = m.result === 'G' ? 3 : m.result === 'E' ? 1 : 0;
  });

  body.innerHTML = '<tr><td colspan="9" class="sb-empty" style="padding:14px;">Cargando…</td></tr>';

  try {
    const stats = await getPlayerSeasonStats(SEASON, jornadasDisputadas, teamPointsByRound);
    if (!stats.length) {
      body.innerHTML = '<tr><td colspan="9" class="sb-empty" style="padding:14px;">Todavía no hay datos esta temporada.</td></tr>';
      return;
    }

    // Mapa de calor por columna: verde para quien va mejor en ese dato
    // concreto, rojo pálido para quien va peor — igual que en el Excel.
    const columns = ['partidosJugados', 'porcentajePartidos', 'goles', 'golesPorPartido', 'asistencias', 'asistenciasPorPartido', 'valoracionMedia', 'puntosPorPartido'];
    const ranges = {};
    columns.forEach((col) => {
      const values = stats.map((s) => s[col]).filter((v) => v != null);
      ranges[col] = { min: Math.min(...values, 0), max: Math.max(...values, 0) };
    });

    function heatStyle(col, value) {
      if (value == null) return '';
      const { min, max } = ranges[col];
      if (max === min) return '';
      const ratio = (value - min) / (max - min);
      const r = Math.round(230 - ratio * 150);
      const g = Math.round(140 + ratio * 90);
      const b = Math.round(140 - ratio * 40);
      return `style="background-color: rgba(${r}, ${g}, ${b}, 0.45);"`;
    }

    body.innerHTML = stats.map((s) => `
      <tr>
        <td>${shortPlayerName(s.name)}</td>
        <td ${heatStyle('partidosJugados', s.partidosJugados)}>${s.partidosJugados}</td>
        <td ${heatStyle('porcentajePartidos', s.porcentajePartidos)}>${s.porcentajePartidos}%</td>
        <td ${heatStyle('goles', s.goles)}><strong>${s.goles}</strong></td>
        <td ${heatStyle('golesPorPartido', s.golesPorPartido)}>${s.golesPorPartido}</td>
        <td ${heatStyle('asistencias', s.asistencias)}>${s.asistencias}</td>
        <td ${heatStyle('asistenciasPorPartido', s.asistenciasPorPartido)}>${s.asistenciasPorPartido}</td>
        <td ${heatStyle('puntosPorPartido', s.puntosPorPartido)}>${s.puntosPorPartido}</td>
        <td ${heatStyle('valoracionMedia', s.valoracionMedia)}>${s.valoracionMedia != null ? s.valoracionMedia : '—'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error cargando estadísticas:', err);
    body.innerHTML = `<tr><td colspan="9" class="sb-empty" style="padding:14px;">No se pudieron cargar (${err.message || 'error'}).</td></tr>`;
  }
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

function openEditActaModal(codActa, acta) {
  const homeTeamName = acta.homeTeam;
  const awayTeamName = acta.awayTeam;

  const homePlayers = [...((acta.home && acta.home.titulares) || []), ...((acta.home && acta.home.suplentes) || [])]
    .map((p) => ({ key: `home::${p.name}`, name: p.name, team: 'home', teamName: homeTeamName }));
  const awayPlayers = [...((acta.away && acta.away.titulares) || []), ...((acta.away && acta.away.suplentes) || [])]
    .map((p) => ({ key: `away::${p.name}`, name: p.name, team: 'away', teamName: awayTeamName }));
  const players = [...homePlayers, ...awayPlayers];

  // Estado en memoria mientras se edita: por jugador, sus goles (cada uno
  // con minuto y asistencia opcional) y su tarjeta.
  const state = new Map(players.map((p) => [p.key, { goals: [], card: null }]));

  // Precargamos lo que ya hubiera en el acta, emparejando por nombre exacto
  // con la alineación (si un nombre no encaja, el gol/tarjeta se pierde del
  // encaje automático pero se puede volver a añadir a mano).
  const byName = new Map(players.map((p) => [p.name, p.key]));
  (acta.goals || []).forEach((g) => {
    const scorerKey = byName.get(g.scorer);
    if (scorerKey) state.get(scorerKey).goals.push({ minute: g.minute, assistKey: g.assist ? byName.get(g.assist) : null });
  });
  ((acta.home && acta.home.cards) || []).forEach((c) => {
    const key = byName.get(c.player);
    if (key) state.get(key).card = { type: c.color === 'roja' ? 'roja' : 'amarilla', minute: c.minute };
  });
  ((acta.away && acta.away.cards) || []).forEach((c) => {
    const key = byName.get(c.player);
    if (key) state.get(key).card = { type: c.color === 'roja' ? 'roja' : 'amarilla', minute: c.minute };
  });

  function playerRowHtml(p) {
    const entry = state.get(p.key);
    const goalsTags = entry.goals
      .map((g, i) => `
        <span class="player-goal-tag" data-goal-idx="${i}">
          ⚽ ${g.minute != null ? g.minute + "'" : ''}${g.assistKey ? ` (asist. ${shortName(players.find((x) => x.key === g.assistKey)?.name || '')})` : ''}
          <button type="button" data-remove-goal="${p.key}" data-idx="${i}">✕</button>
        </span>
      `).join('');
    const cardTag = entry.card
      ? `<span class="player-card-tag ${entry.card.type === 'roja' ? 'red' : 'yellow'}">
          ${entry.card.type === 'roja' ? '🟥' : '🟨'} ${entry.card.minute != null ? entry.card.minute + "'" : ''}
          <button type="button" data-remove-card="${p.key}">✕</button>
        </span>`
      : '';

    return `
      <li class="player-result-row" data-player-row="${p.key}">
        <span class="player-result-name">${p.name} <span style="color:var(--slate-light);font-weight:400;">(${shortName(p.teamName)})</span></span>
        <span class="player-result-tags">${goalsTags}${cardTag}</span>
        <span class="player-result-actions">
          <button type="button" class="acta-btn" data-add-goal="${p.key}">⚽ Gol</button>
          <button type="button" class="acta-btn" data-add-yellow="${p.key}">🟨</button>
          <button type="button" class="acta-btn" data-add-red="${p.key}">🟥</button>
        </span>
      </li>
    `;
  }

  function renderPlayerList() {
    const list = document.getElementById('acta-players-list');
    if (list) list.innerHTML = players.map(playerRowHtml).join('');
    wirePlayerRows();
  }

  function wirePlayerRows() {
    document.querySelectorAll('[data-add-goal]').forEach((btn) => {
      btn.addEventListener('click', () => openMiniGoalForm(btn.dataset.addGoal));
    });
    document.querySelectorAll('[data-add-yellow]').forEach((btn) => {
      btn.addEventListener('click', () => { state.get(btn.dataset.addYellow).card = { type: 'amarilla', minute: null }; renderPlayerList(); });
    });
    document.querySelectorAll('[data-add-red]').forEach((btn) => {
      btn.addEventListener('click', () => { state.get(btn.dataset.addRed).card = { type: 'roja', minute: null }; renderPlayerList(); });
    });
    document.querySelectorAll('[data-remove-goal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.get(btn.dataset.removeGoal).goals.splice(Number(btn.dataset.idx), 1);
        renderPlayerList();
      });
    });
    document.querySelectorAll('[data-remove-card]').forEach((btn) => {
      btn.addEventListener('click', () => { state.get(btn.dataset.removeCard).card = null; renderPlayerList(); });
    });
  }

  function openMiniGoalForm(scorerKey) {
    const scorer = players.find((p) => p.key === scorerKey);
    // La asistencia solo puede venir de un compañero del mismo equipo.
    const assistOptions = players.filter((p) => p.team === scorer.team && p.key !== scorerKey);
    openClubModal(`
      <h3 class="club-modal-title">Gol de ${scorer.name}</h3>
      <div class="field-group">
        <label class="field-label">Minuto (opcional)</label>
        <input type="number" min="0" id="mini-goal-minute" class="club-select" placeholder="ej. 35" />
      </div>
      <div class="field-group">
        <label class="field-label">Asistencia (opcional)</label>
        <select id="mini-goal-assist" class="club-select">
          <option value="">-- sin asistencia --</option>
          ${assistOptions.map((p) => `<option value="${p.key}">${p.name}</option>`).join('')}
        </select>
      </div>
      <button class="acta-btn acta-btn-alt club-submit" id="mini-goal-save">Añadir gol</button>
    `);
    document.getElementById('mini-goal-save').addEventListener('click', () => {
      const minute = document.getElementById('mini-goal-minute').value;
      const assistKey = document.getElementById('mini-goal-assist').value || null;
      state.get(scorerKey).goals.push({ minute: minute ? Number(minute) : null, assistKey });
      reopenMainModal();
    });
  }

  function reopenMainModal() {
    openMainModal();
  }

  function openMainModal() {
    openClubModal(`
      <h3 class="club-modal-title">Editar acta</h3>
      <p class="club-modal-sub">${shortName(homeTeamName)} vs ${shortName(awayTeamName)}</p>
      <div class="admin-panel-title">Goles y tarjetas — toca un jugador</div>
      <ul id="acta-players-list" class="player-result-list"></ul>
      <div id="acta-edit-error" class="club-error"></div>
      <button class="acta-btn acta-btn-alt club-submit" id="acta-edit-save">Guardar cambios</button>
    `);
    renderPlayerList();

    document.getElementById('acta-edit-save').addEventListener('click', async () => {
      const errorEl = document.getElementById('acta-edit-error');
      const goals = [];
      const homeCards = [];
      const awayCards = [];

      state.forEach((entry, key) => {
        const p = players.find((x) => x.key === key);
        entry.goals.forEach((g) => {
          goals.push({
            scorer: p.name,
            minute: g.minute,
            assist: g.assistKey ? (players.find((x) => x.key === g.assistKey)?.name || null) : null,
          });
        });
        if (entry.card) {
          const card = { player: p.name, color: entry.card.type, minute: entry.card.minute };
          if (p.team === 'home') homeCards.push(card); else awayCards.push(card);
        }
      });

      try {
        await updateActa(codActa, { goals, homeCards, awayCards });
        closeClubModal();
        window.openActa(codActa);
        renderScorers();
      } catch (err) {
        console.error(err);
        errorEl.textContent = 'No se pudo guardar (' + (err.message || 'error') + ').';
      }
    });
  }

  openMainModal();
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

  const isAdmin = currentUser() ? await getMyAdminStatus() : false;

  const homeTeamName = acta.homeTeam;
  const awayTeamName = acta.awayTeam;
  const homeIsOwn = isOwn(homeTeamName);
  const awayIsOwn = isOwn(awayTeamName);

  const finalScore = { homeScore: acta.homeGoals, awayScore: acta.awayGoals };

  const metaBits = [];
  if (acta.date) metaBits.push(acta.date);
  if (acta.time) metaBits.push(`${acta.time} h`);
  metaBits.push(`Jornada ${acta.round}`);

  const goalsHtml = acta.goals && acta.goals.length
    ? `<ul class="acta-goals-list">${acta.goals
        .map(
          (g) => `
        <li>
          ${g.homeScore != null && g.awayScore != null ? `<span class="acta-goal-score">${g.homeScore}-${g.awayScore}</span>` : ''}
          <span class="acta-goal-minute">${g.minute != null ? `${g.minute}'` : ''}</span>
          <span>${g.scorer}${g.assist ? ` <span style="color:var(--slate-light);">(asist. ${g.assist})</span>` : ''}${g.penalty ? ' (penalti)' : ''}${g.ownGoal ? ' (propia puerta)' : ''}</span>
        </li>`
        )
        .join('')}</ul>`
    : '<p class="acta-empty">Sin goles registrados</p>';

  const allCards = [
    ...((acta.home && acta.home.cards) || []).map((c) => ({ ...c, team: acta.home.teamName })),
    ...((acta.away && acta.away.cards) || []).map((c) => ({ ...c, team: acta.away.teamName })),
  ];
  const cardsHtml = allCards.length
    ? `<ul class="acta-goals-list">${allCards
        .map(
          (c) => `
        <li>
          <span class="acta-card-dot ${c.color === 'roja' ? 'red' : 'yellow'}"></span>
          <span class="acta-goal-minute">${c.final ? 'Final' : c.minute != null ? `${c.minute}'` : ''}</span>
          <span>${c.player} <span class="acta-card-team">(${shortName(c.team)})</span></span>
        </li>`
        )
        .join('')}</ul>`
    : '';

  const editBtnHtml = isAdmin
    ? `<p style="text-align:center;margin-top:18px;"><button class="acta-btn" id="edit-acta-btn">Editar acta</button></p>`
    : '';

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

    ${cardsHtml ? `<div class="acta-section-title">Tarjetas</div>${cardsHtml}` : ''}

    <div class="acta-section-title">Alineaciones</div>
    <div class="acta-lineups">
      <div>${teamActaHtml(acta.home)}</div>
      <div>${teamActaHtml(acta.away)}</div>
    </div>
    ${editBtnHtml}
  `;

  const editBtn = document.getElementById('edit-acta-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => openEditActaModal(codActa, acta));
  }
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
    window.CLUB_IS_ADMIN = false;
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

  // Solo consideramos "sesión activa" (para mostrar votar/ranking/
  // goleadores) si tu email está en la lista autorizada del club.
  window.CLUB_LOGGED_IN = !!myPlayerIdCache;
  window.CLUB_IS_ADMIN = myPlayerIdCache ? await getMyAdminStatus() : false;
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


function wireAdminPanel(admin) {
  if (!admin) return;
  const openBtn = document.getElementById('open-add-match-modal');
  if (!openBtn) return;
  openBtn.addEventListener('click', openAddMatchModal);
}

function openAddMatchModal() {
  openClubModal(`
    <h3 class="club-modal-title">Añadir partido de pretemporada</h3>
    <div class="field-group">
      <label class="field-label">Rival</label>
      <input type="text" id="custom-opponent" placeholder="Nombre del rival" class="club-select" />
    </div>
    <div class="field-group">
      <label class="field-label">Fecha (DD-MM-AAAA)</label>
      <input type="text" id="custom-date" class="club-select" inputmode="numeric" placeholder="ej. 20-08-2026" />
    </div>
    <div class="field-group">
      <label class="field-label">Hora (HH:MM)</label>
      <input type="text" id="custom-time" class="club-select" inputmode="numeric" placeholder="ej. 19:00" />
    </div>
    <div class="field-group">
      <label class="field-label">Campo</label>
      <input type="text" id="custom-venue" placeholder="Nombre del campo" class="club-select" />
    </div>
    <label style="display:flex; align-items:center; gap:8px; font-size:13px; margin-top:6px;">
      <input type="checkbox" id="custom-ishome" />
      Jugamos en casa
    </label>
    <div id="custom-add-error" class="club-error"></div>
    <button class="acta-btn acta-btn-alt club-submit" id="custom-add-btn">Añadir partido</button>
  `);

  attachDateAutoFormat(document.getElementById('custom-date'));
  attachTimeAutoFormat(document.getElementById('custom-time'));

  document.getElementById('custom-add-btn').addEventListener('click', async () => {
    const opponent = document.getElementById('custom-opponent').value.trim();
    const date = document.getElementById('custom-date').value.trim();
    const time = document.getElementById('custom-time').value.trim();
    const venue = document.getElementById('custom-venue').value.trim();
    const isHome = document.getElementById('custom-ishome').checked;
    const errorEl = document.getElementById('custom-add-error');
    const addBtn = document.getElementById('custom-add-btn');

    if (!opponent) { errorEl.textContent = 'Escribe el nombre del rival.'; return; }
    if (!/^\d{2}-\d{2}-\d{4}$/.test(date)) { errorEl.textContent = 'La fecha debe tener el formato DD-MM-AAAA.'; return; }
    if (time && !/^\d{1,2}:\d{2}$/.test(time)) { errorEl.textContent = 'La hora debe tener el formato HH:MM.'; return; }

    addBtn.disabled = true;
    try {
      await addCustomMatch({ opponent, date, time, venue, isHome });
      closeClubModal();
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

  const roster = await getRoster();
  let players = roster;
  try {
    const attendance = await getAttendance(SEASON, round);
    if (attendance && attendance.length) {
      const byId = new Map(roster.map((p) => [p.id, p.name]));
      players = attendance.map((id) => ({ id, name: byId.get(id) || id }));
    }
  } catch (err) { /* usamos toda la plantilla */ }

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

  const roster = await getRoster();
  let players = roster;
  try {
    const attendance = await getAttendance(match.season, match.round);
    if (attendance && attendance.length) {
      const byId = new Map(roster.map((p) => [p.id, p.name]));
      players = attendance.map((id) => ({ id, name: byId.get(id) || id }));
    }
  } catch (err) { /* usamos toda la plantilla */ }

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
// ---- init ---------------------------------------------------
document.getElementById('club-close')?.addEventListener('click', closeClubModal);
document.getElementById('club-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'club-overlay') closeClubModal();
});

onAuthChange(async () => {
  await renderAuthWidget();
});

async function init() {
  await renderAuthWidget();
}

if (window.APP_DATA) {
  init();
} else {
  document.addEventListener('app-data-ready', init, { once: true });
}
