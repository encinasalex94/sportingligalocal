const OWN_TEAM_ID = '1000030';
const OWN_TEAM_NAME = 'SPORTING DE MADERASA - BAR JUANJO';

let DATA = null;

async function loadData() {
  const res = await fetch('data/data.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('No se pudo cargar data/data.json');
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
    el.innerHTML = `<p class="sb-empty">Aún no hay resultados disponibles para esta jornada.</p>`;
    document.getElementById('hero-result-badge').innerHTML = '';
    document.getElementById('hero-meta').innerHTML = '';
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

function renderMatchCard(m, roundNumber) {
  const isOwnMatch = isOwn(m.homeTeam) || isOwn(m.awayTeam);
  const pending = !m.played;
  const score = pending ? 'vs' : `${m.homeGoals} : ${m.awayGoals}`;
  const metaHtml = renderMetaRow(m.time, m.venue, 'meta-row-center');
  const actaBtn = m.codActa
    ? `<div class="acta-btn-wrap"><button class="acta-btn" onclick="openActa('${m.codActa}')">${ICON_DOC}Ver acta</button></div>`
    : '';
  const loggedIn = !!window.CLUB_LOGGED_IN;
  const votarBtn = isOwnMatch && m.played && loggedIn
    ? `<div class="acta-btn-wrap"><button class="acta-btn acta-btn-alt" onclick="window.openVotar && window.openVotar(${roundNumber})">${ICON_VOTE}Votar</button></div>`
    : '';
  const rankingBtn = isOwnMatch && m.played && loggedIn
    ? `<div class="acta-btn-wrap"><button class="acta-btn acta-btn-ghost" onclick="window.openRanking && window.openRanking(${roundNumber})">${ICON_STAR}Ranking</button></div>`
    : '';
  return `
    <div class="match-card ${isOwnMatch ? 'is-own' : ''} ${pending ? 'is-pending' : ''}">
      <div class="match-card-row">
        <span class="match-team home ${isOwn(m.homeTeam) ? 'home-own' : ''}">${shortName(m.homeTeam)}</span>
        <span class="match-score ${pending ? 'is-pending' : ''}">${score}</span>
        <span class="match-team away ${isOwn(m.awayTeam) ? 'away-own' : ''}">${shortName(m.awayTeam)}</span>
      </div>
      ${metaHtml}
      <div class="acta-btn-row">${actaBtn}${votarBtn}${rankingBtn}</div>
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
    grid.innerHTML = round.matches.map((m) => renderMatchCard(m, round.round)).join('');
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

// Temporadas que ofrece el desplegable de la propia web de FFMadrid. De
// momento solo tenemos datos cargados de la temporada actual; el resto se
// irán añadiendo cuando descarguemos su histórico (ver README).
// De momento solo mostramos la temporada actual. Cuando arranque 2026-2027
// (o se cargue el histórico de años anteriores), añádelas aquí:
//   { value: '22', label: '2026-2027' },
//   { value: '20', label: '2024-2025' },
//   { value: '19', label: '2023-2024' },
//   { value: '18', label: '2022-2023' },
//   { value: '17', label: '2021-2022' },
//   { value: '15', label: '2019-2020' },
//   { value: '14', label: '2018-2019' },
const AVAILABLE_SEASONS = [
  { value: '21', label: '2025-2026' },
];

function renderSeasonSelector(data) {
  const select = document.getElementById('season-select');
  if (!select) return;
  const currentSeason = data.season || '2025-2026';

  select.innerHTML = AVAILABLE_SEASONS
    .map((s) => `<option value="${s.value}" ${s.label === currentSeason ? 'selected' : ''}>${s.label}</option>`)
    .join('');

  select.addEventListener('change', () => {
    const chosen = AVAILABLE_SEASONS.find((s) => s.value === select.value);
    if (chosen && chosen.label === currentSeason) {
      // Volvemos a la temporada con datos: repintamos todo con normalidad.
      renderRoundSelector(DATA);
    } else {
      showSeasonUnavailable(chosen ? chosen.label : select.value);
    }
  });
}

function showSeasonUnavailable(seasonLabel) {
  document.getElementById('round-select').innerHTML = '<option>—</option>';
  document.getElementById('round-label-2').textContent = '';
  document.getElementById('results-grid').innerHTML =
    `<p class="results-empty">Sin datos de la temporada ${seasonLabel}.</p>`;
  document.getElementById('standings-body').innerHTML = '';
}

function renderScorerList(elId, scorers, emptyMsg) {
  const el = document.getElementById(elId);
  if (!scorers || scorers.length === 0) {
    el.innerHTML = `<li class="sb-empty" style="padding:14px;">${emptyMsg}</li>`;
    return;
  }
  el.innerHTML = scorers
    .map(
      (s) => `
      <li class="${s.isOwnTeam ? 'is-own' : ''}">
        <div class="scorer-name">
          <span class="scorer-player">${s.player}</span>
          <span class="scorer-team">${s.team}${s.penalties ? ` · ${s.penalties} de penalti` : ''}</span>
        </div>
        <span class="scorer-goals">${s.goals}</span>
      </li>
    `
    )
    .join('');
}

function renderCalendar(data) {
  const list = document.getElementById('calendar-list');
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
      const actaBtn = m.codActa
        ? `<button class="acta-btn-icon" onclick="openActa('${m.codActa}')" title="Ver acta" aria-label="Ver acta">${ICON_DOC}</button>`
        : '';
      const loggedIn = !!window.CLUB_LOGGED_IN;
      const votarBtn = m.played && loggedIn
        ? `<button class="acta-btn-icon acta-btn-icon-alt" onclick="window.openVotar && window.openVotar(${m.round})" title="Votar" aria-label="Votar">${ICON_VOTE}</button>`
        : '';
      const rankingBtn = m.played && loggedIn
        ? `<button class="acta-btn-icon" onclick="window.openRanking && window.openRanking(${m.round})" title="Ranking" aria-label="Ranking">${ICON_STAR}</button>`
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
          <div class="acta-icon-row">${actaBtn}${votarBtn}${rankingBtn}</div>
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

// ---- Modal: ficha del partido (acta) ---------------------------------
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
    ${team.substitutions && team.substitutions.length ? `<div class="acta-lineup-label">Cambios</div><ul class="acta-player-list">${team.substitutions.map((s) => `<li>${s}</li>`).join('')}</ul>` : ''}
  `;
}

function findMatchByCodActa(codActa) {
  if (!DATA || !DATA.rounds) return null;
  for (const r of DATA.rounds) {
    const match = (r.matches || []).find((m) => String(m.codActa) === String(codActa));
    if (match) return { round: r.round, match };
  }
  return null;
}

function openActa(codActa) {
  const found = findMatchByCodActa(codActa);
  const overlay = document.getElementById('acta-overlay');
  const content = document.getElementById('acta-content');

  if (!found || !found.match.acta) {
    content.innerHTML = '<p class="acta-empty" style="text-align:center;padding:20px 0;">Ficha no disponible todavía para este partido.</p>';
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    return;
  }

  const { round, match } = found;
  const acta = match.acta;
  const homeTeamName = match.homeTeam;
  const awayTeamName = match.awayTeam;
  const homeIsOwn = isOwn(homeTeamName);
  const awayIsOwn = isOwn(awayTeamName);

  const finalScore = acta.goals && acta.goals.length
    ? acta.goals[acta.goals.length - 1]
    : { homeScore: match.homeGoals, awayScore: match.awayGoals };

  const metaBits = [];
  if (acta.date) metaBits.push(acta.date);
  if (acta.time) metaBits.push(`${acta.time} h`);
  metaBits.push(`Jornada ${round}`);

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
  `;

  overlay.classList.add('is-open');
  document.body.style.overflow = 'hidden';
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
    renderScoreboard(data);
    renderSeasonSelector(data);
    renderRoundSelector(data);
    renderCalendar(data);
    renderScorerList('own-scorers', data.ownTeamScorers, 'Todavía no hay goleadores registrados.');
    renderScorerList('top-scorers', data.topScorers, 'Todavía no hay goleadores registrados.');
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
