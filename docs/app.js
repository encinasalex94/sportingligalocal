const OWN_TEAM_ID = '1000030';

async function loadData() {
  const res = await fetch('data/data.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('No se pudo cargar data/data.json');
  return res.json();
}

function shortName(name) {
  // Recorta nombres largos de equipo tipo "SPORTING DE MADERASA - BAR JUANJO"
  // a algo más legible en tarjetas pequeñas, conservando el nombre completo en title=.
  return name.trim();
}

function renderScoreboard(data) {
  const el = document.getElementById('hero-scoreboard');
  const own = data.lastRoundResults.find(
    (m) => m.homeTeamId === OWN_TEAM_ID || m.awayTeamId === OWN_TEAM_ID
  );

  if (!own) {
    el.innerHTML = `<p class="sb-empty">Aún no hay resultados disponibles para esta jornada.</p>`;
    return;
  }

  const isHome = own.homeTeamId === OWN_TEAM_ID;
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

function renderResults(data) {
  const grid = document.getElementById('results-grid');
  grid.innerHTML = data.lastRoundResults
    .map((m) => {
      const isOwn = m.homeTeamId === OWN_TEAM_ID || m.awayTeamId === OWN_TEAM_ID;
      return `
        <div class="match-card ${isOwn ? 'is-own' : ''}">
          <span class="match-team home ${m.homeTeamId === OWN_TEAM_ID ? 'home-own' : ''}">${shortName(m.homeTeam)}</span>
          <span class="match-score">${m.homeGoals ?? '-'} : ${m.awayGoals ?? '-'}</span>
          <span class="match-team away ${m.awayTeamId === OWN_TEAM_ID ? 'away-own' : ''}">${shortName(m.awayTeam)}</span>
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

function renderMeta(data) {
  document.getElementById('round-label').textContent = data.competition.round || 'Última jornada';
  document.getElementById('round-label-2').textContent = data.competition.round || '';
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
    renderMeta(data);
    renderScoreboard(data);
    renderStandings(data);
    renderResults(data);
    renderScorerList('own-scorers', data.ownTeamScorers, 'Todavía no hay goleadores registrados.');
    renderScorerList('top-scorers', data.topScorers, 'Todavía no hay goleadores registrados.');
  } catch (err) {
    console.error(err);
    document.querySelector('main').innerHTML =
      '<div class="wrap" style="padding:60px 0;text-align:center;color:#56698C;">No se han podido cargar los datos. Vuelve a intentarlo más tarde.</div>';
  }
}

init();
