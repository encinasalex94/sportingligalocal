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

function renderScoreboard(data) {
  const el = document.getElementById('hero-scoreboard');
  const own = data.lastRoundResults.find(
    (m) => m.homeTeamId === OWN_TEAM_ID || m.awayTeamId === OWN_TEAM_ID || isOwn(m.homeTeam) || isOwn(m.awayTeam)
  );

  if (!own) {
    el.innerHTML = `<p class="sb-empty">Aún no hay resultados disponibles para esta jornada.</p>`;
    return;
  }

  const isHome = own.homeTeamId === OWN_TEAM_ID || isOwn(own.homeTeam);
  const result =
    own.homeGoals === own.awayGoals
      ? 'EMPATE'
      : (isHome ? own.homeGoals > own.awayGoals : own.awayGoals > own.homeGoals)
      ? 'VICTORIA'
      : 'DERROTA';

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
      <span class="sb-badge">${result}</span>
    </div>
  `;
}

function renderStandings(data) {
  const tbody = document.getElementById('standings-body');
  tbody.innerHTML = data.standings
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
          <td class="col-form"><span class="form-dots">${form}</span></td>
        </tr>
      `;
    })
    .join('');
}

function renderMatchCard(m) {
  const isOwnMatch = isOwn(m.homeTeam) || isOwn(m.awayTeam);
  const pending = !m.played;
  const score = pending ? 'vs' : `${m.homeGoals} : ${m.awayGoals}`;
  return `
    <div class="match-card ${isOwnMatch ? 'is-own' : ''} ${pending ? 'is-pending' : ''}">
      <span class="match-team home ${isOwn(m.homeTeam) ? 'home-own' : ''}">${shortName(m.homeTeam)}</span>
      <span class="match-score ${pending ? 'is-pending' : ''}">${score}</span>
      <span class="match-team away ${isOwn(m.awayTeam) ? 'away-own' : ''}">${shortName(m.awayTeam)}</span>
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
    return;
  }

  label.textContent = `Jornada ${round.round}${round.date ? ` (${round.date})` : ''}`;

  if (!round.matches || round.matches.length === 0) {
    grid.innerHTML = '<p class="results-empty">Todavía no se ha publicado el calendario de esta jornada.</p>';
    return;
  }

  grid.innerHTML = round.matches.map(renderMatchCard).join('');
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

  // Seleccionar por defecto la última jornada con resultados, o la primera si ninguna se ha jugado.
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

function copaResultBadge(m) {
  if (!m.played) return '';
  if (m.result === 'G') return '<span class="copa-badge win">Victoria</span>';
  if (m.result === 'E') return '<span class="copa-badge draw">Empate</span>';
  if (m.result === 'P') return '<span class="copa-badge loss">Derrota</span>';
  return '';
}

function renderCopa(data) {
  const container = document.getElementById('copa-stages');
  const stages = (data.copa && data.copa.stages) || [];

  if (stages.length === 0) {
    container.innerHTML = '<p class="results-empty">Sin datos de Copa todavía.</p>';
    return;
  }

  container.innerHTML = stages
    .map((stage, idx) => {
      const rows = stage.matches
        .map((m) => {
          const pending = !m.played;
          const opponent = m.opponent || 'Rival por determinar';
          const teamsHtml = m.isHome === false
            ? `${shortName(opponent)} <span style="color:var(--slate-light)">vs</span> <span class="own">${OWN_TEAM_NAME}</span>`
            : `<span class="own">${OWN_TEAM_NAME}</span> <span style="color:var(--slate-light)">vs</span> ${shortName(opponent)}`;
          const score = pending ? '—' : `${m.goalsFor} : ${m.goalsAgainst}`;
          const roundTag = stage.knockout ? (m.roundLabel || `Ronda ${m.round}`) : (m.date || `Jornada ${m.round}`);
          const qualifiedBadge = m.qualified ? '<span class="copa-badge qualified">Clasificado</span>' : '';
          const penaltiesTag = m.penalties ? ` <span style="color:var(--slate-light);font-family:var(--font-mono);font-size:10px;">(pen. ${m.penalties})</span>` : '';

          return `
            <div class="copa-match-row">
              <span class="copa-round-tag">${roundTag}</span>
              <span class="copa-teams">${teamsHtml}</span>
              <span class="copa-score ${pending ? 'is-pending' : ''}">${score}${penaltiesTag}</span>
              ${pending ? '<span class="copa-badge" style="background:var(--ice);color:var(--slate);">Pendiente</span>' : copaResultBadge(m)}
              ${qualifiedBadge}
            </div>
          `;
        })
        .join('');

      return `
        <div class="copa-stage">
          <h3 class="copa-stage-title"><span class="stage-index">${idx + 1}</span> ${stage.label}</h3>
          ${rows || '<p class="results-empty">Sin partidos registrados en esta ronda todavía.</p>'}
        </div>
      `;
    })
    .join('');
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
      return `
        <div class="calendar-item ${cls}">
          <div class="calendar-round">
            <span>J${m.round}</span>
            <span class="calendar-venue">${m.isHome ? 'Casa' : 'Fuera'}</span>
          </div>
          <span class="calendar-opponent" title="${m.opponent}">${shortName(m.opponent)}</span>
          <span class="calendar-score">${score}</span>
          <span class="calendar-date">${m.date || ''}</span>
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
  document.getElementById('position-number').textContent = ownStanding ? ownStanding.position : '—';

  if (data.generatedAt) {
    const d = new Date(data.generatedAt);
    document.getElementById('updated-at').textContent =
      'Última actualización: ' +
      d.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
  }
}

async function init() {
  try {
    const data = await loadData();
    DATA = data;
    renderMeta(data);
    renderScoreboard(data);
    renderStandings(data);
    renderRoundSelector(data);
    renderCopa(data);
    renderCalendar(data);
    renderScorerList('own-scorers', data.ownTeamScorers, 'Todavía no hay goleadores registrados.');
    renderScorerList('top-scorers', data.topScorers, 'Todavía no hay goleadores registrados.');
  } catch (err) {
    console.error(err);
    document.querySelector('main').innerHTML =
      '<div class="wrap" style="padding:60px 0;text-align:center;color:#56698C;">No se han podido cargar los datos. Vuelve a intentarlo más tarde.</div>';
  }
}

init();
