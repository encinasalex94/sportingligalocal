const OWN_TEAM_ID = '1000030';
const OWN_TEAM_NAME = 'SPORTING DE MADERASA - BAR JUANJO';

let DATA = null;

async function loadData(file = 'data/data.json') {
  const res = await fetch(file, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo cargar ${file}`);
  return res.json();
}

function shortName(name) {
  return (name || '').trim();
}

function isOwn(name) {
  return (name || '').toUpperCase().includes(OWN_TEAM_NAME);
}

function formatVenue(venue) {
  if (!venue) return '';
  // "ENRIQUE MORENO - B - Hierba Artificial" -> "Enrique Moreno - B"
  const parts = venue.split(' - ');
  if (parts.length >= 2) {
    return `${titleCase(parts[0])} - ${parts[1]}`;
  }
  return titleCase(venue);
}

function titleCase(str) {
  return str
    .toLowerCase()
    .replace(/(^|\s)([a-záéíóúñ])/g, (m, sp, c) => sp + c.toUpperCase());
}

const ICON_CLOCK =
  '<svg class="meta-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICON_PIN =
  '<svg class="meta-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21s7-6.1 7-11.5a7 7 0 1 0-14 0C5 14.9 12 21 12 21Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="2.3" stroke="currentColor" stroke-width="1.8"/></svg>';

const ICON_DOC =
  '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 13h6M9 17h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

const ICON_VOTE =
  '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 12.5l2 2 4.5-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/></svg>';

const ICON_STAR =
  '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5l2.6 5.4 5.9.7-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.7L12 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

// Ventana de votación: 24h desde el inicio del partido. Esto es solo para
// decidir si se MUESTRA el botón "Votar" (mejor experiencia); el bloqueo
// real e infalsificable vive en las reglas de Firestore (matchMeta).
function isVotingWindowOpen(dateStr, timeStr) {
  if (!dateStr) return true; // sin fecha, no ocultamos por precaución
  const [d, m, y] = dateStr.split('-').map(Number);
  let hh = 0, mm = 0;
  if (timeStr) {
    const parts = timeStr.split(':').map(Number);
    hh = parts[0] || 0;
    mm = parts[1] || 0;
  }
  const kickoff = new Date(y, m - 1, d, hh, mm);
  const closesAt = kickoff.getTime() + 24 * 60 * 60 * 1000;
  return Date.now() < closesAt;
}

// Genera la fila de "chips" de hora y campo, reutilizada en el marcador
// destacado, las tarjetas de resultados y el calendario.
function renderMetaRow(time, venue, extraClass = '') {
  const chips = [];
  if (time) chips.push(`<span class="meta-chip">${ICON_CLOCK}${time}</span>`);
  if (venue) chips.push(`<span class="meta-chip">${ICON_PIN}${formatVenue(venue)}</span>`);
  if (!chips.length) return '';
  return `<div class="meta-row ${extraClass}">${chips.join('')}</div>`;
}

function renderScoreboard(data) {
  const el = document.getElementById('hero-scoreboard');
  const own = data.lastRoundResults.find(
    (m) => m.homeTeamId === OWN_TEAM_ID || m.awayTeamId === OWN_TEAM_ID || isOwn(m.homeTeam) || isOwn(m.awayTeam)
  );

  if (!own) {
    // Sin partidos jugados todavía: buscamos el próximo programado (el más
    // cercano en el tiempo) y lo mostramos como "próximo partido".
    const now = new Date();
    const upcoming = (data.rounds || [])
      .flatMap((r) => r.matches.map((m) => ({ ...m, roundDate: r.date })))
      .filter((m) => isOwn(m.homeTeam) || isOwn(m.awayTeam))
      .filter((m) => !m.played)
      .map((m) => {
        const dateStr = m.date || m.roundDate;
        let dt = null;
        if (dateStr) {
          const [d, mo, y] = dateStr.split('-').map(Number);
          let hh = 0, mm = 0;
          if (m.time) { const p = m.time.split(':').map(Number); hh = p[0] || 0; mm = p[1] || 0; }
          dt = new Date(y, mo - 1, d, hh, mm);
        }
        return { ...m, dateStr, dt };
      })
      .filter((m) => !m.dt || m.dt > now)
      .sort((a, b) => (a.dt?.getTime() || Infinity) - (b.dt?.getTime() || Infinity));

    const next = upcoming[0];
    if (!next) {
      el.innerHTML = `<p class="sb-empty">Aún no hay partidos programados.</p>`;
      document.getElementById('hero-result-badge').innerHTML = '';
      document.getElementById('hero-meta').innerHTML = '';
      return;
    }

    const isHomeNext = isOwn(next.homeTeam);
    el.innerHTML = `
      <div class="sb-team ${isHomeNext ? 'is-own' : ''}">
        <span class="sb-team-name">${shortName(next.homeTeam)}</span>
      </div>
      <div class="sb-score"><span>-</span><span class="dash">:</span><span>-</span></div>
      <div class="sb-team ${!isHomeNext ? 'is-own' : ''}">
        <span class="sb-team-name">${shortName(next.awayTeam)}</span>
      </div>
    `;
    document.getElementById('hero-result-badge').innerHTML = `<span class="sb-badge">PRÓXIMO PARTIDO</span>`;
    document.getElementById('hero-meta').innerHTML = renderMetaRow(next.time, next.venue, 'meta-row-center');
    document.getElementById('round-label').textContent = 'Próximo partido';
    return;
  }

  const isHome = own.homeTeamId === OWN_TEAM_ID || isOwn(own.homeTeam);
  const result =
    own.homeGoals === own.awayGoals
      ? 'EMPATE'
      : (isHome ? own.homeGoals > own.awayGoals : own.awayGoals > own.homeGoals)
      ? 'VICTORIA'
      : 'DERROTA';

  const metaHtml = renderMetaRow(own.time, own.venue, 'meta-row-center');

  el.innerHTML = `
    <div class="sb-team ${isHome ? 'is-own' : ''}">
      <span class="sb-team-name">${shortName(own.homeTeam)}</span>
    </div>
    <div class="sb-score">
      <span>${own.homeGoals ?? '-'}</span>
      <span class="dash">:</span>
      <span>${own.awayGoals ?? '-'}</span>
    </div>
    <div class="sb-team ${!isHome ? 'is-own' : ''}">
      <span class="sb-team-name">${shortName(own.awayTeam)}</span>
    </div>
  `;
  document.getElementById('hero-result-badge').innerHTML = `<span class="sb-badge">${result}</span>`;
  document.getElementById('hero-meta').innerHTML = metaHtml;
}

function standingsRowsHtml(standings) {
  return standings
    .map((row) => {
      const dgClass = row.goalDifference > 0 ? 'positive' : row.goalDifference < 0 ? 'negative' : '';
      const dgSign = row.goalDifference > 0 ? '+' : '';
      const form = (row.form || [])
        .map((r) => {
          const cls = r === 'G' ? 'g' : r === 'E' ? 'e' : 'p';
          return `<span class="form-dot ${cls}" title="${r === 'G' ? 'Ganado' : r === 'E' ? 'Empatado' : 'Perdido'}">${r}</span>`;
        })
        .join('');

      return `
        <tr class="${row.isOwnTeam ? 'own-row' : ''}">
          <td>${row.position}</td>
          <td class="cell-team">${row.teamName}</td>
          <td><strong>${row.points}</strong></td>
          <td>${row.played}</td>
          <td>${row.won}</td>
          <td>${row.drawn}</td>
          <td>${row.lost}</td>
          <td>${row.goalsFor}</td>
          <td>${row.goalsAgainst}</td>
          <td class="cell-dg ${dgClass}">${dgSign}${row.goalDifference}</td>
          <td class="col-form">${form ? `<span class="form-dots">${form}</span>` : '—'}</td>
        </tr>
      `;
    })
    .join('');
}

// Calcula la clasificación a fecha de una jornada concreta, sumando todos los
// partidos disputados en jornadas <= roundNumber. Se usa cuando el usuario
// elige una jornada distinta a la última disputada, para que la tabla
// refleje ese momento de la temporada (puede diferir levemente de la oficial
// en desempates especiales que aplique la federación).
function computeStandingsAsOf(rounds, roundNumber) {
  const teams = new Map();
  function ensure(name) {
    if (!teams.has(name)) {
      teams.set(name, {
        teamName: name, played: 0, won: 0, drawn: 0, lost: 0,
        goalsFor: 0, goalsAgainst: 0, points: 0, form: [],
        isOwnTeam: isOwn(name),
      });
    }
    return teams.get(name);
  }

  const relevantRounds = rounds.filter((r) => r.round <= roundNumber).sort((a, b) => a.round - b.round);

  for (const r of relevantRounds) {
    for (const m of r.matches) {
      if (!m.played) continue;
      const home = ensure(m.homeTeam);
      const away = ensure(m.awayTeam);
      home.played++; away.played++;
      home.goalsFor += m.homeGoals; home.goalsAgainst += m.awayGoals;
      away.goalsFor += m.awayGoals; away.goalsAgainst += m.homeGoals;
      if (m.homeGoals > m.awayGoals) {
        home.won++; away.lost++; home.points += 3;
        home.form.push('G'); away.form.push('P');
      } else if (m.homeGoals < m.awayGoals) {
        away.won++; home.lost++; away.points += 3;
        away.form.push('G'); home.form.push('P');
      } else {
        home.drawn++; away.drawn++; home.points += 1; away.points += 1;
        home.form.push('E'); away.form.push('E');
      }
    }
  }

  const table = Array.from(teams.values()).map((t) => ({
    ...t,
    goalDifference: t.goalsFor - t.goalsAgainst,
    form: t.form.slice(-5),
  }));

  table.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor);
  table.forEach((t, i) => { t.position = i + 1; });
  return table;
}

function renderStandings(standings, options = {}) {
  const tbody = document.getElementById('standings-body');
  tbody.innerHTML = standingsRowsHtml(standings);
}

function renderMatchCard(m, roundNumber, roundDate) {
  const isOwnMatch = isOwn(m.homeTeam) || isOwn(m.awayTeam);
  const pending = !m.played;
  const score = pending ? 'vs' : `${m.homeGoals} : ${m.awayGoals}`;
  const metaHtml = renderMetaRow(m.time, m.venue, 'meta-row-center');
  const loggedIn = !!window.CLUB_LOGGED_IN;
  const actaBtn = m.played && m.codActa && loggedIn
    ? `<div class="acta-btn-wrap"><button class="acta-btn" onclick="openActa('${m.codActa}')">${ICON_DOC}Ver acta</button></div>`
    : '';
  const votarBtn = isOwnMatch && m.played && loggedIn && isVotingWindowOpen(m.date || roundDate, m.time)
    ? `<div class="acta-btn-wrap"><button class="acta-btn acta-btn-alt" onclick="window.openVotar && window.openVotar(${roundNumber})">${ICON_VOTE}Votar</button></div>`
    : '';
  const rankingBtn = isOwnMatch && m.played && loggedIn
    ? `<div class="acta-btn-wrap"><button class="acta-btn acta-btn-ghost" onclick="window.openRanking && window.openRanking(${roundNumber})">${ICON_STAR}Ranking</button></div>`
    : '';
  const btnRow = (actaBtn || votarBtn || rankingBtn)
    ? `<div class="acta-btn-row">${actaBtn}${votarBtn}${rankingBtn}</div>`
    : '';
  return `
    <div class="match-card ${isOwnMatch ? 'is-own' : ''} ${pending ? 'is-pending' : ''}">
      <div class="match-card-row">
        <span class="match-team home ${isOwn(m.homeTeam) ? 'home-own' : ''}">${shortName(m.homeTeam)}</span>
        <span class="match-score ${pending ? 'is-pending' : ''}">${score}</span>
        <span class="match-team away ${isOwn(m.awayTeam) ? 'away-own' : ''}">${shortName(m.awayTeam)}</span>
      </div>
      ${metaHtml}
      ${btnRow}
    </div>
  `;
}

function renderRound(roundNumber) {
  const round = DATA.rounds.find((r) => r.round === roundNumber);
  const grid = document.getElementById('results-grid');
  const label = document.getElementById('round-label-2');

  if (!round) {
    grid.innerHTML = '<p class="results-empty">No hay datos para esta jornada.</p>';
    label.textContent = '';
    renderStandings(DATA.standings, { computed: false });
    return;
  }

  label.textContent = `Jornada ${round.round}${round.date ? ` (${round.date})` : ''}`;

  if (!round.matches || round.matches.length === 0) {
    grid.innerHTML = '<p class="results-empty">Todavía no se ha publicado el calendario de esta jornada.</p>';
  } else {
    grid.innerHTML = round.matches.map((m) => renderMatchCard(m, round.round, round.date)).join('');
  }

  // La clasificación acompaña a la jornada elegida: si es la última jugada,
  // mostramos la oficial de la federación; si es otra, la calculamos.
  const playedRounds = DATA.rounds.filter((r) => r.matches.some((m) => m.played));
  const lastPlayedRound = playedRounds.length ? playedRounds[playedRounds.length - 1].round : null;

  if (roundNumber === lastPlayedRound || lastPlayedRound === null) {
    renderStandings(DATA.standings, { computed: false });
  } else {
    const computed = computeStandingsAsOf(DATA.rounds, roundNumber);
    renderStandings(computed, { computed: true, round: roundNumber });
  }
}

function renderRoundSelector(data) {
  const select = document.getElementById('round-select');
  const rounds = data.rounds || [];

  select.innerHTML = rounds
    .map((r) => {
      const hasResults = r.matches && r.matches.some((m) => m.played);
      const statusTag = hasResults ? '' : ' · pendiente';
      return `<option value="${r.round}">Jornada ${r.round} (${r.date || 's/f'})${statusTag}</option>`;
    })
    .join('');

  const playedRounds = rounds.filter((r) => r.matches && r.matches.some((m) => m.played));
  const defaultRound = playedRounds.length ? playedRounds[playedRounds.length - 1].round : rounds[0]?.round;

  if (defaultRound) {
    select.value = String(defaultRound);
    renderRound(defaultRound);
  }

  select.addEventListener('change', () => {
    renderRound(Number(select.value));
  });
}

// Estructura de dos niveles: la Temporada manda, y el Tipo disponible
// depende de ella. 2026-2027 todavía no tiene calendario de Liga/Copa
// publicado por la federación, así que solo ofrece "Pretemporada" (los
// amistosos que se van añadiendo desde la Convocatoria). 2025-2026 es la
// temporada real con datos completos de FFMadrid.
const SEASONS = [
  {
    label: '2026-2027',
    dataFile: 'data/data.json',
    types: [
      { value: 'liga', label: 'Liga' },
      // Cuando la federación publique el calendario de Copa 2026-2027:
      // { value: 'copa', label: 'Copa' },
    ],
  },
  {
    label: '2025-2026',
    dataFile: 'data/season-2025-2026.json',
    types: [
      { value: 'liga', label: 'Liga' },
    ],
  },
];

// Consultadas por club-ui.js para saber qué pintar en el calendario.
window.CURRENT_SEASON_LABEL = null;
window.CURRENT_COMPETITION_TYPE = null;

// Evita volver a descargar el JSON de una temporada que ya se cargó antes.
const seasonDataCache = new Map();

async function getSeasonData(seasonLabel) {
  if (seasonDataCache.has(seasonLabel)) return seasonDataCache.get(seasonLabel);
  const season = SEASONS.find((s) => s.label === seasonLabel) || SEASONS[0];
  const data = await loadData(season.dataFile);
  seasonDataCache.set(seasonLabel, data);
  return data;
}

function applyView(seasonLabel, type, data) {
  window.CURRENT_SEASON_LABEL = seasonLabel;
  window.CURRENT_COMPETITION_TYPE = type;

  // Mantenemos sincronizados el DATA global y window.APP_DATA con la
  // temporada que se esté viendo ahora mismo — otras partes de la web
  // (club-ui.js, el selector de jornada, etc.) dependen de esto.
  DATA = data;
  window.APP_DATA = data;
  renderMeta(data);

  // La Clasificación y los Resultados son cosas de la Liga real; no
  // aplican a Pretemporada ni a Copa (sin datos todavía) — así que
  // directamente se ocultan enteras, en vez de mostrarse vacías.
  const isLiga = type === 'liga';
  const isCopa = type === 'copa';
  toggleSectionById('clasificacion', 'divider-clasificacion', isLiga);
  toggleSectionById('resultados', 'divider-resultados', !isCopa);

  // El marcador destacado: en Liga es el último resultado real de ESA
  // temporada (hay que repintarlo, no vale con uno fijo cargado al
  // principio); en Copa no hay datos, se oculta; en Pretemporada lo
  // decide club-ui.js según haya o no amistosos.
  const heroSection = document.getElementById('scoreboard-hero-section');
  if (isLiga) {
    if (heroSection) heroSection.style.display = '';
    renderScoreboard(data);
  } else if (heroSection) {
    heroSection.style.display = 'none'; // en pretemporada se revela solo si hay amistosos
  }

  if (isLiga) {
    renderRoundSelector(data);
  } else {
    const roundSelect = document.getElementById('round-select');
    if (roundSelect) roundSelect.innerHTML = '<option>—</option>';
    const grid = document.getElementById('results-grid');
    const label = document.getElementById('round-label-2');
    if (grid && type === 'pretemporada') grid.innerHTML = '<p class="results-empty">Cargando…</p>';
    if (label && type === 'pretemporada') label.textContent = '';
  }
  renderCalendar(data);
  window.onCompetitionViewChanged && window.onCompetitionViewChanged(type);
}

function toggleSectionById(sectionId, dividerId, show) {
  const section = document.getElementById(sectionId);
  if (section) section.style.display = show ? '' : 'none';
  if (dividerId) {
    const divider = document.getElementById(dividerId);
    if (divider) divider.style.display = show ? '' : 'none';
  }
}

function renderTypeSelector(seasonLabel, data) {
  const season = SEASONS.find((s) => s.label === seasonLabel) || SEASONS[0];
  const typeSelect = document.getElementById('competition-type-select');
  if (!typeSelect) return;

  typeSelect.innerHTML = season.types.map((t) => `<option value="${t.value}">${t.label}</option>`).join('');
  typeSelect.value = season.types[0].value;
  typeSelect.disabled = season.types.length <= 1; // nada que elegir todavía

  typeSelect.onchange = () => {
    applyView(seasonLabel, typeSelect.value, data);
  };

  applyView(seasonLabel, typeSelect.value, data);
}

function renderSeasonSelector(initialData) {
  const select = document.getElementById('season-select');
  if (!select) return;

  select.innerHTML = SEASONS.map((s) => `<option value="${s.label}">${s.label}</option>`).join('');
  select.value = SEASONS[0].label; // 2026-2027 por defecto
  seasonDataCache.set(SEASONS[0].label, initialData); // ya la tenemos, nos la ahorramos volver a pedir

  select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      const data = await getSeasonData(select.value);
      renderTypeSelector(select.value, data);
    } catch (err) {
      console.error(err);
      alert('No se pudieron cargar los datos de esa temporada.');
    } finally {
      select.disabled = false;
    }
  });

  renderTypeSelector(select.value, initialData);
}

// Los "Goleadores" (nombres de jugadores) ya no viven en data.json ni se
// pintan desde aquí — ahora se leen de Firestore y se pintan desde
// club-ui.js, solo cuando hay sesión iniciada. Ver club-ui.js.

function renderCalendar(data) {
  const list = document.getElementById('calendar-list');
  const summaryEl = document.getElementById('calendar-summary');

  // El calendario de partidos de Liga solo aplica cuando el Tipo elegido es
  // "Liga". Para "Pretemporada" lo rellena club-ui.js con los amistosos;
  // para "Copa" no hay nada que mostrar todavía.
  const showRealSeason = window.CURRENT_COMPETITION_TYPE === 'liga';
  if (!showRealSeason) {
    list.innerHTML = '';
    if (summaryEl) {
      summaryEl.textContent = window.CURRENT_COMPETITION_TYPE === 'copa'
        ? 'Sin calendario de Copa publicado todavía'
        : '';
    }
    return;
  }

  const calendar = data.ownTeamCalendar || [];

  if (calendar.length === 0) {
    list.innerHTML = '<p class="sb-empty">Todavía no hay partidos registrados.</p>';
    document.getElementById('calendar-summary').textContent = '';
    return;
  }

  const played = calendar.filter((m) => m.played);
  const wins = played.filter((m) => m.result === 'G').length;
  const draws = played.filter((m) => m.result === 'E').length;
  const losses = played.filter((m) => m.result === 'P').length;
  document.getElementById('calendar-summary').textContent =
    `${calendar.length} jornadas · ${wins}G ${draws}E ${losses}P`;

  list.innerHTML = calendar
    .map((m) => {
      const cls = m.result === 'G' ? 'win' : m.result === 'E' ? 'draw' : m.result === 'P' ? 'loss' : '';
      const score = m.played ? `${m.goalsFor} - ${m.goalsAgainst}` : 'Pendiente';
      const metaHtml = renderMetaRow(m.time, m.venue, 'meta-row-compact');
      const loggedIn = !!window.CLUB_LOGGED_IN;
      const actaBtn = m.played && m.codActa && loggedIn
        ? `<div class="acta-btn-wrap"><button class="acta-btn" onclick="openActa('${m.codActa}')">${ICON_DOC}Ver acta</button></div>`
        : '';
      const votarBtn = m.played && loggedIn && isVotingWindowOpen(m.date, m.time)
        ? `<div class="acta-btn-wrap"><button class="acta-btn acta-btn-alt" onclick="window.openVotar && window.openVotar(${m.round})">${ICON_VOTE}Votar</button></div>`
        : '';
      const rankingBtn = m.played && loggedIn
        ? `<div class="acta-btn-wrap"><button class="acta-btn acta-btn-ghost" onclick="window.openRanking && window.openRanking(${m.round})">${ICON_STAR}Ranking</button></div>`
        : '';
      const iconRow = (actaBtn || votarBtn || rankingBtn)
        ? `<div class="acta-btn-row">${actaBtn}${votarBtn}${rankingBtn}</div>`
        : '';
      return `
        <div class="calendar-item ${cls}">
          <div class="calendar-round">
            <span>J${m.round}</span>
            <span class="calendar-venue">${m.isHome ? 'Casa' : 'Fuera'}</span>
          </div>
          <span class="calendar-opponent" title="${m.opponent}">${shortName(m.opponent)}</span>
          <span class="calendar-score">${score}</span>
          <span class="calendar-date">${m.date || ''}</span>
          ${metaHtml}
          ${iconRow}
        </div>
      `;
    })
    .join('');
}

function renderMeta(data) {
  document.getElementById('round-label').textContent = data.competition.round || 'Última jornada';
  document.getElementById('competition-title').textContent =
    `${data.competition.title || ''} · ${data.competition.season || ''}`.trim();

  const ownStanding = data.standings.find((s) => s.isOwnTeam);
  document.getElementById('position-number').textContent = ownStanding ? `${ownStanding.position}ª` : '—';

  if (data.generatedAt) {
    const d = new Date(data.generatedAt);
    document.getElementById('updated-at').textContent =
      'Última actualización: ' +
      d.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
  }
}

function closeActa() {
  document.getElementById('acta-overlay').classList.remove('is-open');
  document.body.style.overflow = '';
}

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('acta-overlay');
  const closeBtn = document.getElementById('acta-close');
  if (closeBtn) closeBtn.addEventListener('click', closeActa);
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeActa();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeActa();
  });
});

async function init() {
  try {
    const data = await loadData();
    DATA = data;
    window.APP_DATA = data;
    renderMeta(data);
    renderSeasonSelector(data);
    // Referencia fija a la temporada EN CURSO (2026-2027), independiente de
    // qué temporada esté navegando el usuario en los selectores — la
    // Convocatoria siempre debe mirar aquí, nunca a una temporada archivada.
    window.LIVE_SEASON_DATA = data;
    document.dispatchEvent(new CustomEvent('app-data-ready', { detail: data }));

    // Gancho para que club-ui.js pueda pedir un repintado cuando cambie el
    // estado de sesión (para mostrar/ocultar los botones de Votar/Ranking).
    window.rerenderClubDependentUI = function rerenderClubDependentUI() {
      const select = document.getElementById('round-select');
      const currentRound = select && select.value ? Number(select.value) : null;
      if (currentRound) renderRound(currentRound);
      renderCalendar(DATA);
    };
  } catch (err) {
    console.error(err);
    document.querySelector('main').innerHTML =
      '<div class="wrap" style="padding:60px 0;text-align:center;color:#56698C;">No se han podido cargar los datos. Vuelve a intentarlo más tarde.</div>';
  }
}

init();
