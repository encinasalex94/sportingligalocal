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

  const metaBits = [];
  if (own.time) metaBits.push(own.time);
  if (own.venue) metaBits.push(formatVenue(own.venue));
  const metaHtml = metaBits.length ? `<div class="sb-meta">${metaBits.join(' · ')}</div>` : '';

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
  const note = document.getElementById('standings-note');
  note.textContent = options.computed
    ? `Clasificación calculada a fecha de la jornada ${options.round} (puede variar levemente de la oficial en desempates especiales).`
    : 'Clasificación oficial tras la última jornada disputada. Usa el selector de "Ver jornada" más abajo para ver la clasificación en otro momento de la temporada.';
  note.style.display = '';
}

function renderMatchCard(m) {
  const isOwnMatch = isOwn(m.homeTeam) || isOwn(m.awayTeam);
  const pending = !m.played;
  const score = pending ? 'vs' : `${m.homeGoals} : ${m.awayGoals}`;
  const metaBits = [];
  if (m.time) metaBits.push(m.time);
  if (m.venue) metaBits.push(formatVenue(m.venue));
  const metaHtml = metaBits.length ? `<span class="match-meta">${metaBits.join(' · ')}</span>` : '';
  return `
    <div class="match-card ${isOwnMatch ? 'is-own' : ''} ${pending ? 'is-pending' : ''}">
      <div class="match-card-row">
        <span class="match-team home ${isOwn(m.homeTeam) ? 'home-own' : ''}">${shortName(m.homeTeam)}</span>
        <span class="match-score ${pending ? 'is-pending' : ''}">${score}</span>
        <span class="match-team away ${isOwn(m.awayTeam) ? 'away-own' : ''}">${shortName(m.awayTeam)}</span>
      </div>
      ${metaHtml}
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
    grid.innerHTML = round.matches.map(renderMatchCard).join('');
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

function renderSeasonSelector(data) {
  const select = document.getElementById('season-select');
  if (!select) return;
  const season = data.season || '2025-2026';
  select.innerHTML = `<option value="${season}">${season}</option>`;
  select.disabled = true;
  select.title = 'De momento solo tenemos datos de la temporada actual. Cuando el club juegue más temporadas con esta web, aparecerán aquí.';
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
  } else {
    container.innerHTML = stages
      .map((stage, idx) => {
        const rows = stage.matches
          .map((m) => {
            const pending = !m.played;
            const opponent = m.opponent || 'Rival por determinar';
            const teamsHtml = m.isHome === false
              ? `${shortName(opponent)} <span style="color:var(--slate-light)">vs</span> <span class="own">${OWN_TEAM_NAME}</span>`
              : `<span class="own">${OWN_TEAM_NAME}</span> <span style="color:var(--slate-light)">vs</span> ${shortName(opponent)}`;
            // El marcador se lee en el mismo orden que los equipos de arriba
            // (local primero, visitante después).
            const leftGoals = m.isHome === false ? m.goalsAgainst : m.goalsFor;
            const rightGoals = m.isHome === false ? m.goalsFor : m.goalsAgainst;
            const score = pending ? '—' : `${leftGoals} : ${rightGoals}`;
            const roundTag = stage.knockout ? (m.roundLabel || `Ronda ${m.round}`) : (m.date || `Jornada ${m.round}`);
            const qualifiedBadge = m.qualified ? '<span class="copa-badge qualified">Clasificado</span>' : '';
            const penaltiesTag = m.penalties ? ` <span style="color:var(--slate-light);font-family:var(--font-mono);font-size:10px;">(pen. ${m.penalties})</span>` : '';
            const metaBits = [];
            if (m.time) metaBits.push(m.time);
            if (m.venue) metaBits.push(formatVenue(m.venue));
            const metaHtml = metaBits.length ? `<span class="copa-meta">${metaBits.join(' · ')}</span>` : '';

            return `
              <div class="copa-match-row">
                <span class="copa-round-tag">${roundTag}${metaHtml ? `<br>${metaHtml}` : ''}</span>
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

  renderCopaGroupStandings(data);
}

function renderCopaGroupStandings(data) {
  const wrap = document.getElementById('copa-group-standings-wrap');
  const table = (data.copa && data.copa.groupStandings) || [];
  if (!wrap) return;

  if (!table.length) {
    wrap.innerHTML = '';
    return;
  }

  const rows = table
    .map(
      (t) => `
        <tr class="${t.isOwnTeam ? 'own-row' : ''}">
          <td>${t.position}</td>
          <td class="cell-team">${t.teamName}</td>
          <td><strong>${t.points}</strong></td>
          <td>${t.played}</td>
          <td>${t.won}</td>
          <td>${t.drawn}</td>
          <td>${t.lost}</td>
          <td>${t.goalsFor}</td>
          <td>${t.goalsAgainst}</td>
          <td>${t.goalDifference > 0 ? '+' : ''}${t.goalDifference}</td>
        </tr>
      `
    )
    .join('');

  wrap.innerHTML = `
    <h3 class="copa-stage-title" style="margin-top:6px;">Clasificación de la fase de grupos</h3>
    <p class="section-sub" style="margin-bottom:14px;">${data.copa.groupStandingsNote || 'Tabla elaborada combinando los partidos de grupo, ya que la federación no ofrece una clasificación conjunta.'}</p>
    <div class="table-scroll">
      <table class="standings">
        <thead>
          <tr>
            <th class="col-pos">#</th>
            <th class="col-team">Equipo</th>
            <th>Pts</th>
            <th>PJ</th>
            <th>G</th>
            <th>E</th>
            <th>P</th>
            <th>GF</th>
            <th>GC</th>
            <th>DG</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
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
      const metaBits = [];
      if (m.time) metaBits.push(m.time);
      if (m.venue) metaBits.push(formatVenue(m.venue));
      return `
        <div class="calendar-item ${cls}">
          <div class="calendar-round">
            <span>J${m.round}</span>
            <span class="calendar-venue">${m.isHome ? 'Casa' : 'Fuera'}</span>
          </div>
          <span class="calendar-opponent" title="${m.opponent}">${shortName(m.opponent)}</span>
          <span class="calendar-score">${score}</span>
          <span class="calendar-date">${m.date || ''}${metaBits.length ? ` · ${metaBits.join(' · ')}` : ''}</span>
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
    renderSeasonSelector(data);
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
