/**
 * Scraper para el Sporting de Maderasa - Bar Juanjo
 * -------------------------------------------------
 * Inicia sesión en la intranet NFG de FFMadrid (aranjuez.ffmadrid.es) con las
 * credenciales del club y descarga:
 *   - Clasificación y calendario completo de la Liga (todas las jornadas,
 *     todos los partidos, incluidas las jornadas aún no disputadas)
 *   - Tabla de goleadores del grupo de Liga
 *   - Recorrido completo en la Copa: fase de grupos, rondas extra de grupos
 *     y fase final eliminatoria (octavos, cuartos, semifinal, final)
 *
 * Guarda todo en docs/data/data.json, que luego lee la web estática (docs/).
 *
 * Variables de entorno requeridas (ver .env.example / GitHub Secrets):
 *   NFG_USER  -> usuario de acceso al club en aranjuez.ffmadrid.es
 *   NFG_PASS  -> clave de acceso
 *
 * Uso local:
 *   NFG_USER=xxxx NFG_PASS=xxxx node scraper/scrape.js
 */

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// ---- Configuración del club / competiciones --------------------------------
// Estos códigos son específicos de la temporada 2025-2026 en la Liga Local de
// Aranjuez. Cada temporada nueva hay que revisarlos navegando la web de FFMadrid
// con las credenciales del club (los parámetros salen en la URL de cada página
// de "Clasificación" / "Calendario").
const CONFIG = {
  baseUrl: 'https://aranjuez.ffmadrid.es',
  codPrimaria: '1000128',
  codTemporada: '21', // 2025-2026
  codEquipoPropio: '1000030', // SPORTING DE MADERASA - BAR JUANJO
  nombreEquipoPropio: 'SPORTING DE MADERASA - BAR JUANJO',

  liga: {
    codCompeticion: '1009587', // LIGA AFICIONADOS F-11
    codGrupo: '1009591', // 1ª AFICIONADOS F-11
  },

  // La Copa en NFG está repartida en varias "competiciones" distintas porque
  // así lo modela su software (cada tanda de partidos de grupos tiene su
  // propio código, y la fase final es otra competición aparte). Cada entrada
  // aquí es una etapa del camino del equipo en la Copa.
  copaStages: [
    { key: 'grupos', label: 'Fase de grupos', codCompeticion: '1009598', codGrupo: '1010292' },
    { key: 'ronda4', label: '4º partido (grupos)', codCompeticion: '1009607', codGrupo: '1009635' },
    { key: 'ronda5', label: '5º partido (grupos)', codCompeticion: '1010502', codGrupo: '1010515' },
    {
      key: 'final',
      label: 'Fase final',
      codCompeticion: '1010540',
      codGrupo: '1010542',
      knockout: true,
    },
  ],
};

const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'data.json');

const jar = new CookieJar();
const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    timeout: 20000,
  })
);

function log(...args) {
  console.log('[scrape]', ...args);
}

function isOwnTeamName(name) {
  return (name || '').toUpperCase().includes(CONFIG.nombreEquipoPropio);
}

async function login() {
  const user = process.env.NFG_USER;
  const pass = process.env.NFG_PASS;

  if (!user || !pass) {
    throw new Error(
      'Faltan las variables de entorno NFG_USER y/o NFG_PASS con las credenciales del club.'
    );
  }

  await client.get(`${CONFIG.baseUrl}/nfg/`);

  const body = new URLSearchParams({
    NUser: user,
    NPass: pass,
    LoginAjax: '1',
  });

  const loginResp = await client.post(`${CONFIG.baseUrl}/nfg/NLogin`, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const okLogin =
    loginResp.status === 200 &&
    !/usuario y\/o contrase/i.test(loginResp.data) &&
    !/no son validos/i.test(loginResp.data);

  if (!okLogin) {
    throw new Error(
      'El login en NFG no parece haber funcionado. Revisa NFG_USER/NFG_PASS. Respuesta: ' +
        String(loginResp.data).slice(0, 300)
    );
  }

  log('Login OK');
}

// ---- Clasificación (Liga) --------------------------------------------------
async function fetchClasificacion() {
  const url = `${CONFIG.baseUrl}/nfg/NPcd/NFG_VisClasificacion`;
  const resp = await client.get(url, {
    params: {
      cod_primaria: CONFIG.codPrimaria,
      codgrupo: CONFIG.liga.codGrupo,
      codcompeticion: CONFIG.liga.codCompeticion,
    },
  });

  const $ = cheerio.load(resp.data);

  const tituloCompeticion = $('td.titulocaja').first().text().trim();
  const temporadaTexto = $('.titulocaja')
    .filter((_, el) => /Temporada/i.test($(el).text()))
    .first()
    .text()
    .trim();
  const jornadaTexto = $('.title_categoría').first().text().trim();

  const standings = [];
  $('#CL_Resumen')
    .find('tr[id$="_2"]')
    .each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 10) return;

      const teamLink = $row.find('a[href*="codequipo="]');
      const teamId = (teamLink.attr('href') || '').match(/codequipo=(\d+)/)?.[1] || null;
      const teamName = teamLink.find('span').text().trim() || teamLink.text().trim();

      const position = Number($(cells[1]).text().trim());
      const points = Number($(cells[3]).text().trim());
      const played = Number($(cells[4]).text().trim());
      const won = Number($(cells[5]).text().trim());
      const drawn = Number($(cells[6]).text().trim());
      const lost = Number($(cells[7]).text().trim());
      const goalsFor = Number($(cells[8]).text().trim());
      const goalsAgainst = Number($(cells[9]).text().trim());

      const form = [];
      $(cells[10])
        .find('span[title]')
        .each((__, s) => {
          const title = $(s).attr('title');
          if (title === 'Ganado') form.push('G');
          else if (title === 'Empatado') form.push('E');
          else if (title === 'Perdido') form.push('P');
        });

      standings.push({
        position,
        teamId,
        teamName,
        points,
        played,
        won,
        drawn,
        lost,
        goalsFor,
        goalsAgainst,
        goalDifference: goalsFor - goalsAgainst,
        form,
        isOwnTeam: teamId === CONFIG.codEquipoPropio,
      });
    });

  standings.sort((a, b) => a.position - b.position);

  return { tituloCompeticion, temporadaTexto, jornadaTexto, standings };
}

// ---- Goleadores (Liga) ------------------------------------------------
async function fetchGoleadores() {
  const url = `${CONFIG.baseUrl}/nfg/NPcd/NFG_CMP_Goleadores`;
  const resp = await client.get(url, {
    params: {
      cod_primaria: CONFIG.codPrimaria,
      codcompeticion: CONFIG.liga.codCompeticion,
      codgrupo: CONFIG.liga.codGrupo,
      codtemporada: CONFIG.codTemporada,
    },
  });

  const $ = cheerio.load(resp.data);
  const scorers = [];

  $('table.table.table-striped.table-hover.table-bordered')
    .last()
    .find('tr')
    .each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 5) return;

      const player = $(cells[0]).text().trim();
      const team = $(cells[1]).text().trim();
      const played = Number($(cells[3]).text().trim());
      const goalsText = $(cells[4]).text().trim();
      const goals = Number(goalsText.match(/\d+/)?.[0] || 0);
      const penaltiesMatch = goalsText.match(/\((\d+)\s*de penalti\)/i);

      if (!player) return;

      scorers.push({
        player,
        team,
        played: Number.isFinite(played) ? played : null,
        goals,
        penalties: penaltiesMatch ? Number(penaltiesMatch[1]) : 0,
        isOwnTeam: isOwnTeamName(team),
      });
    });

  scorers.sort((a, b) => b.goals - a.goals);
  return scorers;
}

// ---- Calendario completo (genérico: sirve para Liga y para cada etapa de Copa) --
// Devuelve, por jornada: número, fecha (y etiqueta de ronda para eliminatorias),
// y TODOS los partidos de esa jornada (no solo los del propio equipo). Así el
// selector de jornada de la web puede mostrar cualquier jornada, incluidas las
// que aún no se han jugado.
async function fetchCalendario(codCompeticion, codGrupo, opts = {}) {
  const url = `${CONFIG.baseUrl}/nfg/NPcd/NFG_VisCalendario_Vis`;
  const resp = await client.get(url, {
    params: {
      cod_primaria: CONFIG.codPrimaria,
      codtemporada: CONFIG.codTemporada,
      codcompeticion: codCompeticion,
      codgrupo: codGrupo,
    },
  });

  const $ = cheerio.load(resp.data);

  // Si es una fase eliminatoria, el desplegable de jornada tiene etiquetas
  // como "28-03-2026  (8º)" en vez de solo un número. Las recogemos para
  // poder etiquetar cada ronda con su nombre real (octavos, semifinal...).
  const roundLabels = {};
  if (opts.knockout) {
    $('select#jornada option').each((_, opt) => {
      const val = $(opt).attr('value');
      const text = $(opt).text().trim();
      if (val && val !== '0') roundLabels[val] = text;
    });
  }

  const rounds = [];

  $('div[id^="trPartidosJornada_"]').each((_, div) => {
    const $div = $(div);
    const roundNum = Number(($div.attr('id') || '').replace('trPartidosJornada_', ''));
    if (!roundNum) return;

    const dateText = $div
      .find(`#fecha_jornada_org_${roundNum}`)
      .text()
      .replace(/[()]/g, '')
      .trim();

    const matches = [];
    $div.find('tr[bgcolor]').each((__, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 5) return;

      const homeCell = $(cells[0]);
      const awayCell = $(cells[4]);
      const homeTeam = homeCell.text().replace(/\s+/g, ' ').trim();
      const awayTeam = awayCell.text().replace(/\s+/g, ' ').trim();
      if (!homeTeam || !awayTeam) return;

      const homeGoalsText = $(cells[1]).text().trim();
      const awayGoalsText = $(cells[3]).text().trim();
      const homeGoals = homeGoalsText === '' ? null : Number(homeGoalsText);
      const awayGoals = awayGoalsText === '' ? null : Number(awayGoalsText);
      const played =
        homeGoals !== null && awayGoals !== null && !Number.isNaN(homeGoals) && !Number.isNaN(awayGoals);

      // En la fase eliminatoria aparece "(Clasificado)" junto al equipo que pasa ronda.
      const homeQualified = /Clasificado/i.test(homeCell.parent().text());
      const awayQualified = /Clasificado/i.test(awayCell.parent().text());
      const penaltiesMatch = $row.text().match(/Penaltis:\s*(\d+)\s*-\s*(\d+)/i);

      matches.push({
        homeTeam,
        awayTeam,
        homeGoals,
        awayGoals,
        played,
        homeQualified: opts.knockout ? homeQualified || undefined : undefined,
        awayQualified: opts.knockout ? awayQualified || undefined : undefined,
        penalties: penaltiesMatch ? `${penaltiesMatch[1]}-${penaltiesMatch[2]}` : undefined,
      });
    });

    rounds.push({
      round: roundNum,
      roundLabel: roundLabels[String(roundNum)] || null,
      date: dateText || null,
      matches,
    });
  });

  rounds.sort((a, b) => a.round - b.round);
  return rounds;
}

// A partir del calendario completo (todos los equipos), nos quedamos solo con
// los partidos del propio equipo para construir su "trayectoria" en una
// competición dada.
function extractOwnMatches(rounds) {
  const own = [];
  for (const r of rounds) {
    for (const m of r.matches) {
      const isOwnHome = isOwnTeamName(m.homeTeam);
      const isOwnAway = isOwnTeamName(m.awayTeam);
      if (!isOwnHome && !isOwnAway) continue;

      let result = null;
      if (m.played) {
        const ownGoals = isOwnHome ? m.homeGoals : m.awayGoals;
        const rivalGoals = isOwnHome ? m.awayGoals : m.homeGoals;
        result = ownGoals === rivalGoals ? 'E' : ownGoals > rivalGoals ? 'G' : 'P';
      }

      own.push({
        round: r.round,
        roundLabel: r.roundLabel,
        date: r.date,
        isHome: isOwnHome,
        opponent: isOwnHome ? m.awayTeam : m.homeTeam,
        goalsFor: m.played ? (isOwnHome ? m.homeGoals : m.awayGoals) : null,
        goalsAgainst: m.played ? (isOwnHome ? m.awayGoals : m.homeGoals) : null,
        played: m.played,
        result,
        qualified: isOwnHome ? m.homeQualified : m.awayQualified,
        penalties: m.penalties || null,
      });
    }
  }
  own.sort((a, b) => a.round - b.round);
  return own;
}

async function main() {
  log('Iniciando sesión en NFG...');
  await login();

  log('Descargando clasificación de Liga...');
  const clasificacion = await fetchClasificacion();
  log(`  -> ${clasificacion.standings.length} equipos`);

  log('Descargando calendario completo de Liga (todas las jornadas)...');
  const ligaRounds = await fetchCalendario(CONFIG.liga.codCompeticion, CONFIG.liga.codGrupo);
  log(`  -> ${ligaRounds.length} jornadas`);
  const ownTeamCalendar = extractOwnMatches(ligaRounds);

  log('Descargando goleadores de Liga...');
  const scorers = await fetchGoleadores();
  log(`  -> ${scorers.length} jugadores con gol`);

  log('Descargando recorrido en la Copa...');
  const copa = { stages: [] };
  for (const stage of CONFIG.copaStages) {
    try {
      const rounds = await fetchCalendario(stage.codCompeticion, stage.codGrupo, {
        knockout: !!stage.knockout,
      });
      const ownMatches = extractOwnMatches(rounds);
      copa.stages.push({
        key: stage.key,
        label: stage.label,
        knockout: !!stage.knockout,
        matches: ownMatches,
      });
      log(`  -> ${stage.label}: ${ownMatches.length} partidos del equipo`);
    } catch (err) {
      log(`  -> ${stage.label}: no se pudo descargar (${err.message}), se omite esta vez`);
    }
  }

  // Encontrar la última jornada de Liga con resultados (para el marcador destacado)
  const playedRounds = ligaRounds.filter((r) => r.matches.some((m) => m.played));
  const lastPlayedRound = playedRounds[playedRounds.length - 1] || null;
  const lastRoundResults = lastPlayedRound
    ? lastPlayedRound.matches.map((m) => ({
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeGoals: m.homeGoals,
        awayGoals: m.awayGoals,
      }))
    : [];

  const data = {
    generatedAt: new Date().toISOString(),
    team: {
      id: CONFIG.codEquipoPropio,
      name: CONFIG.nombreEquipoPropio,
    },
    competition: {
      title: clasificacion.tituloCompeticion,
      season: clasificacion.temporadaTexto,
      round: lastPlayedRound
        ? `Jornada ${lastPlayedRound.round} (${lastPlayedRound.date})`
        : clasificacion.jornadaTexto,
    },
    standings: clasificacion.standings,
    lastRoundResults,
    rounds: ligaRounds, // calendario completo, todas las jornadas y partidos, para el selector
    ownTeamCalendar,
    topScorers: scorers.slice(0, 20),
    ownTeamScorers: scorers.filter((s) => s.isOwnTeam),
    copa,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2), 'utf-8');
  log(`Guardado en ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[scrape] ERROR:', err.message);
  process.exit(1);
});
