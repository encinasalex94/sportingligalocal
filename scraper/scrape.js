/**
 * Scraper para el Sporting de Maderasa - Bar Juanjo
 * -------------------------------------------------
 * Inicia sesión en la intranet NFG de FFMadrid (aranjuez.ffmadrid.es) con las
 * credenciales del club y descarga:
 *   - Clasificación y calendario completo de la Liga (todas las jornadas,
 *     todos los partidos, incluidas las jornadas aún no disputadas)
 *   - Hora y campo de los partidos recientes/próximos (Liga) y de todos los
 *     partidos de Copa
 *   - Tabla de goleadores del grupo de Liga
 *   - Recorrido completo en la Copa: fase de grupos, rondas extra de grupos
 *     y fase final eliminatoria (octavos, cuartos, semifinal, final), más una
 *     clasificación de grupos calculada por nosotros combinando las 3 tandas
 *     de partidos de grupo (la propia FFMadrid no ofrece esa tabla combinada)
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
const iconv = require('iconv-lite');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ---- Configuración del club / competiciones --------------------------------
const CONFIG = {
  baseUrl: 'https://aranjuez.ffmadrid.es',
  codPrimaria: '1000128',
  codTemporada: '21', // 2025-2026
  temporadaTexto: '2025-2026',
  codEquipoPropio: '1000030',
  nombreEquipoPropio: 'SPORTING DE MADERASA - BAR JUANJO',

  liga: {
    codCompeticion: '1009587',
    codGrupo: '1009591',
  },

  // Nota: esta temporada el club también jugó la Copa Aficionados F-11, pero
  // como no está garantizado que se dispute todos los años, la web no la
  // descarga ni la muestra. Si en el futuro quieres reactivarla, aquí van
  // los códigos de aquella edición como referencia:
  //   Fase de grupos: codCompeticion 1009598, codGrupo 1010292
  //   4º partido (grupos): codCompeticion 1009607, codGrupo 1009635
  //   5º partido (grupos): codCompeticion 1010502, codGrupo 1010515
  //   Fase final (octavos a final, un único documento): codCompeticion 1010540, codGrupo 1010542
};

const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'data.json');
const REQUEST_DELAY_MS = 400; // para no saturar el servidor de FFMadrid

// ---- Firebase Admin (para escribir actas y goleadores, datos con nombres
// de jugadores, fuera del data.json público) --------------------------
let firestoreDb = null;
function initFirebase() {
  if (firestoreDb) return firestoreDb;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    log('Aviso: no hay FIREBASE_SERVICE_ACCOUNT configurado; se omite la escritura en Firestore (actas/goleadores no se actualizarán ahí).');
    return null;
  }
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  firestoreDb = admin.firestore();
  return firestoreDb;
}

async function getExistingActaIds() {
  const db = initFirebase();
  if (!db) return new Set();
  const snap = await db.collection('actas').listDocuments();
  return new Set(snap.map((d) => d.id));
}

async function writeMatchMetaToFirestore(ownTeamCalendar, season) {
  const db = initFirebase();
  if (!db) return { written: 0 };
  let written = 0;
  for (const m of ownTeamCalendar) {
    if (!m.played || !m.date) continue;
    const [d, mo, y] = m.date.split('-').map(Number);
    let hh = 0, mm = 0;
    if (m.time) {
      const parts = m.time.split(':').map(Number);
      hh = parts[0] || 0;
      mm = parts[1] || 0;
    }
    const kickoff = new Date(y, mo - 1, d, hh, mm);
    const matchId = `${season}_J${m.round}`;
    await db.collection('matchMeta').doc(matchId).set({
      round: m.round,
      date: m.date,
      time: m.time || null,
      kickoffAt: admin.firestore.Timestamp.fromDate(kickoff),
    });
    written++;
  }
  return { written };
}

async function writeActasToFirestore(ligaRounds) {
  const db = initFirebase();
  if (!db) return { written: 0 };
  let written = 0;
  for (const r of ligaRounds) {
    for (const m of r.matches) {
      if (!m.codActa || !m.acta) continue;
      await db.collection('actas').doc(String(m.codActa)).set({
        ...m.acta,
        round: r.round,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeGoals: m.homeGoals,
        awayGoals: m.awayGoals,
        updatedAt: Date.now(),
      });
      written++;
    }
  }
  return { written };
}

async function writeScorersToFirestore(topScorers, ownTeamScorers) {
  const db = initFirebase();
  if (!db) return;
  await db.collection('scorers').doc('current').set({
    topScorers,
    ownTeamScorers,
    updatedAt: Date.now(),
  });
}

const jar = new CookieJar();
const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
    responseType: 'arraybuffer', // recibimos bytes crudos para decodificarlos nosotros
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    timeout: 20000,
  })
);

// La web de aranjuez.ffmadrid.es está codificada en ISO-8859-15 (lo declara
// en su <meta charset>), NO en UTF-8. Si dejamos que axios/cheerio traten la
// respuesta como UTF-8 por defecto, las tildes y símbolos (á, é, í, ó, ú, ñ,
// ª, º...) se corrompen ("SÉK" se convierte en basura, "1ª" en "1◇", etc).
// Decodificamos explícitamente cada respuesta con el charset correcto en el
// propio punto de la petición (nada de interceptores globales, que en algún
// entorno no llegaban a aplicarse de forma fiable).
function decodeBody(data) {
  if (data == null) return '';
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return iconv.decode(buf, 'ISO-8859-15');
}

async function httpGet(url, config = {}) {
  const resp = await client.get(url, { ...config, responseType: 'arraybuffer' });
  return { status: resp.status, data: decodeBody(resp.data) };
}

async function httpPost(url, body, config = {}) {
  const resp = await client.post(url, body, { ...config, responseType: 'arraybuffer' });
  return { status: resp.status, data: decodeBody(resp.data) };
}

function log(...args) {
  console.log('[scrape]', ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  await httpGet(`${CONFIG.baseUrl}/nfg/`);

  const body = new URLSearchParams({ NUser: user, NPass: pass, LoginAjax: '1' });
  const loginResp = await httpPost(`${CONFIG.baseUrl}/nfg/NLogin`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

// ---- Clasificación oficial (Liga) ------------------------------------------
async function fetchClasificacion() {
  const url = `${CONFIG.baseUrl}/nfg/NPcd/NFG_VisClasificacion`;
  const resp = await httpGet(url, {
    params: {
      cod_primaria: CONFIG.codPrimaria,
      codgrupo: CONFIG.liga.codGrupo,
      codcompeticion: CONFIG.liga.codCompeticion,
    },
  });

  const $ = cheerio.load(resp.data);
  const tituloCompeticion = $('td.titulocaja').first().text().trim();

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
        position, teamId, teamName, points, played, won, drawn, lost,
        goalsFor, goalsAgainst, goalDifference: goalsFor - goalsAgainst, form,
        isOwnTeam: teamId === CONFIG.codEquipoPropio,
      });
    });

  standings.sort((a, b) => a.position - b.position);
  return { tituloCompeticion, standings };
}

// ---- Goleadores (Liga) ------------------------------------------------
async function fetchGoleadores() {
  const url = `${CONFIG.baseUrl}/nfg/NPcd/NFG_CMP_Goleadores`;
  const resp = await httpGet(url, {
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
        player, team,
        played: Number.isFinite(played) ? played : null,
        goals,
        penalties: penaltiesMatch ? Number(penaltiesMatch[1]) : 0,
        isOwnTeam: isOwnTeamName(team),
      });
    });

  scorers.sort((a, b) => b.goals - a.goals);
  return scorers;
}

// ---- Calendario completo (genérico) ----------------------------------------
// Todos los partidos de todas las jornadas de una competición/grupo (no solo
// los del propio equipo), para poder: (a) mostrar cualquier jornada en el
// selector, (b) recalcular la clasificación a fecha de una jornada concreta,
// y (c) construir tablas de grupo propias en la Copa.
async function fetchCalendario(codCompeticion, codGrupo, opts = {}) {
  const url = `${CONFIG.baseUrl}/nfg/NPcd/NFG_VisCalendario_Vis`;
  const resp = await httpGet(url, {
    params: {
      cod_primaria: CONFIG.codPrimaria,
      codtemporada: CONFIG.codTemporada,
      codcompeticion: codCompeticion,
      codgrupo: codGrupo,
    },
  });

  const $ = cheerio.load(resp.data);

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

      const homeQualified = /Clasificado/i.test(homeCell.parent().text());
      const awayQualified = /Clasificado/i.test(awayCell.parent().text());
      const penaltiesMatch = $row.text().match(/Penaltis:\s*(\d+)\s*-\s*(\d+)/i);

      matches.push({
        homeTeam, awayTeam, homeGoals, awayGoals, played,
        homeQualified: opts.knockout ? homeQualified || undefined : undefined,
        awayQualified: opts.knockout ? awayQualified || undefined : undefined,
        penalties: penaltiesMatch ? `${penaltiesMatch[1]}-${penaltiesMatch[2]}` : undefined,
        time: null,
        venue: null,
      });
    });

    rounds.push({ round: roundNum, roundLabel: roundLabels[String(roundNum)] || null, date: dateText || null, matches });
  });

  rounds.sort((a, b) => a.round - b.round);
  return rounds;
}

// ---- Detalle de una jornada (hora + campo) vía NFG_CmpJornada ---------------
// El calendario (NFG_VisCalendario_Vis) no trae hora ni campo; solo la página
// de resultados de una jornada concreta (NFG_CmpJornada) los tiene. Por eso
// esto va aparte y solo se llama para las jornadas que nos interesan (no las
// 22 de golpe en cada ejecución, para no message excesivo al servidor).
async function fetchRoundDetail(codCompeticion, codGrupo, codTemporada, jornadaNum) {
  const url = `${CONFIG.baseUrl}/nfg/NPcd/NFG_CmpJornada`;
  const resp = await httpGet(url, {
    params: {
      cod_primaria: CONFIG.codPrimaria,
      CodCompeticion: codCompeticion,
      CodGrupo: codGrupo,
      CodTemporada: codTemporada,
      CodJornada: jornadaNum,
    },
  });

  const $ = cheerio.load(resp.data);
  const details = [];

  $('.portlet-body.body_fed').each((_, block) => {
    const $block = $(block);
    const teamLinks = $block.find('a[href*="Codigo_Equipo"]');
    if (teamLinks.length < 2) return;

    const homeTeam = $(teamLinks[0]).text().replace(/\s+/g, ' ').trim();
    const awayTeam = $(teamLinks[1]).text().replace(/\s+/g, ' ').trim();

    // Fecha + hora: dos <span class="esconder"> dentro del bloque de fecha.
    const esconderSpans = $block.find('h5 span.esconder');
    const time = esconderSpans.length >= 2 ? $(esconderSpans[1]).text().replace(/\s+/g, ' ').trim() : null;

    // Campo: texto tras la etiqueta "Campo:"
    let venue = null;
    const campoLabel = $block.find('span.textocolor b').filter((__, el) => /Campo/i.test($(el).text()));
    if (campoLabel.length) {
      const parentText = campoLabel.first().parent().parent().text().replace(/\s+/g, ' ').trim();
      venue = parentText.replace(/^Campo:\s*/i, '').trim() || null;
    }

    // CodActa: del enlace "Ver ficha del Partido" (icono de portapapeles)
    let codActa = null;
    const actaLink = $block.find('a[href*="NFG_CmpPartido"]');
    if (actaLink.length) {
      const match = (actaLink.attr('href') || '').match(/CodActa=(\d+)/);
      if (match) codActa = match[1];
    }

    if (homeTeam && awayTeam) {
      details.push({ homeTeam, awayTeam, time: time || null, venue: venue || null, codActa });
    }
  });

  return details;
}

// Añade hora/campo a un round ya descargado, buscando coincidencia por nombre de equipos.
function mergeRoundDetail(round, details) {
  if (!details || !details.length) return round;
  for (const m of round.matches) {
    const found = details.find((d) => d.homeTeam === m.homeTeam && d.awayTeam === m.awayTeam);
    if (found) {
      m.time = found.time;
      m.venue = found.venue;
      m.codActa = found.codActa || null;
    }
  }
  return round;
}

// A partir del calendario completo (todos los equipos), extrae solo los
// partidos del propio equipo.
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
        round: r.round, roundLabel: r.roundLabel, date: r.date, time: m.time || null, venue: m.venue || null,
        isHome: isOwnHome, opponent: isOwnHome ? m.awayTeam : m.homeTeam,
        goalsFor: m.played ? (isOwnHome ? m.homeGoals : m.awayGoals) : null,
        goalsAgainst: m.played ? (isOwnHome ? m.awayGoals : m.homeGoals) : null,
        played: m.played, result,
        qualified: isOwnHome ? m.homeQualified : m.awayQualified,
        penalties: m.penalties || null,
        codActa: m.codActa || null,
      });
    }
  }
  own.sort((a, b) => a.round - b.round);
  return own;
}

// ---- Ficha de partido (acta): alineaciones, goles, tarjetas, árbitro ------
async function fetchActa(codActa) {
  const url = `${CONFIG.baseUrl}/nfg/NPcd/NFG_CmpPartido`;
  const resp = await httpGet(url, {
    params: { cod_primaria: CONFIG.codPrimaria, CodActa: codActa, cod_acta: codActa },
  });
  const $ = cheerio.load(resp.data);

  const cabeceraText = $('.tabla_rdg').first().text();
  const fechaMatch = cabeceraText.match(/Fecha:\s*([\d-]+)/);
  const horaMatch = cabeceraText.match(/Hora:\s*([\d:]+)\s*h/);

  // Los dos paneles de equipo (local y visitante), cada uno con su
  // <span class="tituloprograma"> como cabecera. Tarjetas, sustituciones y
  // cuerpo técnico van DENTRO de cada columna, así quedan bien atribuidas
  // a su equipo (antes se buscaban globalmente y se mezclaban).
  const teamPanels = [];
  $('span.tituloprograma').each((_, el) => {
    const $el = $(el);
    const teamName = $el.text().replace(/\s+/g, ' ').trim();
    const $td = $el.closest('td');
    const titulares = [];
    const suplentes = [];
    const cards = [];
    const substitutions = [];

    $td.find('span.title').each((__, titleSpan) => {
      const label = $(titleSpan).text().trim();
      const isTitulares = /^Titulares/i.test(label);
      const isSuplentes = /^Suplentes/i.test(label);
      const isTarjetas = /^TARJETAS/i.test(label);
      const isSustituciones = /^SUSTITUCIONES/i.test(label);

      if (isTitulares || isSuplentes) {
        const $table = $(titleSpan).nextAll('table').first();
        $table.find('tr').each((___, tr) => {
          const tds = $(tr).find('td');
          if (tds.length < 2) return;
          const number = $(tds[0]).text().replace(/\s+/g, '').trim();
          const name = $(tds[tds.length - 1]).text().replace(/\s+/g, ' ').trim();
          if (!name) return;
          if (isTitulares) titulares.push({ number, name });
          else suplentes.push({ number, name });
        });
      } else if (isTarjetas) {
        // Las TARJETAS están dentro de un <center>, la tabla es la siguiente.
        const $table = $(titleSpan).closest('center').nextAll('table').first();
        $table.find('tr').each((___, tr) => {
          const $tr = $(tr);
          const img = $tr.find('img').attr('src') || '';
          const text = $tr.find('td').last().text().replace(/\s+/g, ' ').trim();
          if (!text) return;
          const minuteMatch = text.match(/\((\d+)'|\(Final\)/i);
          cards.push({
            color: /roja/i.test(img) ? 'roja' : 'amarilla',
            player: text.replace(/\s*\([^)]*\)\s*$/, '').trim(),
            minute: minuteMatch && minuteMatch[1] ? Number(minuteMatch[1]) : null,
            final: /\(Final\)/i.test(text),
          });
        });
      } else if (isSustituciones) {
        const $table = $(titleSpan).closest('center').nextAll('table').first();
        $table.find('tr').each((___, tr) => {
          const text = $(tr).text().replace(/\s+/g, ' ').trim();
          if (text) substitutions.push(text);
        });
      }
    });

    let entrenador = null;
    $td.find('td b').each((__, b) => {
      if (!/ENTRENADOR/i.test($(b).text())) return;
      const $nextTr = $(b).closest('tr').next('tr');
      const val = $nextTr.text().replace(/\s+/g, ' ').trim();
      entrenador = val || null;
    });

    teamPanels.push({ teamName, titulares, suplentes, entrenador, cards, substitutions });
  });

  // Árbitro(s)
  const referees = [];
  $('td.title, span.title')
    .filter((_, el) => /ÁRBITROS|ARBITROS/i.test($(el).text().trim()))
    .each((_, el) => {
      const $table = $(el).closest('table');
      $table.find('td.textosm').each((__, td) => {
        const name = $(td).text().replace(/\s+/g, ' ').trim();
        if (name) referees.push(name);
      });
    });

  // Goles: marcador progresivo + autor + minuto
  const goals = [];
  $('span.title')
    .filter((_, el) => /^GOLES$/i.test($(el).text().trim()))
    .each((_, el) => {
      const $table = $(el).closest('center').nextAll('table').first();
      $table.find('tr').each((__, tr) => {
        const $tr = $(tr);
        const cells = $tr.find('td');
        if (cells.length < 2) return;
        const scoreText = $(cells[0]).text().replace(/\s+/g, ' ').trim();
        const scoreMatch = scoreText.match(/(\d+)\s*-\s*(\d+)/);
        const scorerCellText = $(cells[1]).text().replace(/\s+/g, ' ').trim();
        const minuteMatch = scorerCellText.match(/\((\d+)'\)/);
        const scorer = scorerCellText.replace(/\(\d+'\)/, '').trim();
        if (!scoreMatch || !scorer) return;
        goals.push({
          homeScore: Number(scoreMatch[1]),
          awayScore: Number(scoreMatch[2]),
          scorer,
          minute: minuteMatch ? Number(minuteMatch[1]) : null,
          penalty: /penalti/i.test($tr.text()),
          ownGoal: /propia puerta|en propia/i.test($tr.text()),
        });
      });
    });

  return {
    codActa,
    date: fechaMatch ? fechaMatch[1] : null,
    time: horaMatch ? horaMatch[1] : null,
    home: teamPanels[0] || null,
    away: teamPanels[1] || null,
    referees,
    goals,
  };
}

// Calcula una tabla de clasificación a partir de un conjunto de rondas
// (usada para: clasificación de grupos de Copa, ya que la federación no la
// ofrece combinada). 3 puntos por victoria, 1 por empate, igual que la Liga.
function computeStandingsFromRounds(roundsList) {
  const teams = new Map();

  function ensure(name) {
    if (!teams.has(name)) {
      teams.set(name, {
        teamName: name, played: 0, won: 0, drawn: 0, lost: 0,
        goalsFor: 0, goalsAgainst: 0, points: 0, isOwnTeam: isOwnTeamName(name),
      });
    }
    return teams.get(name);
  }

  for (const rounds of roundsList) {
    for (const r of rounds) {
      for (const m of r.matches) {
        if (!m.played) continue;
        const home = ensure(m.homeTeam);
        const away = ensure(m.awayTeam);
        home.played++; away.played++;
        home.goalsFor += m.homeGoals; home.goalsAgainst += m.awayGoals;
        away.goalsFor += m.awayGoals; away.goalsAgainst += m.homeGoals;
        if (m.homeGoals > m.awayGoals) { home.won++; away.lost++; home.points += 3; }
        else if (m.homeGoals < m.awayGoals) { away.won++; home.lost++; away.points += 3; }
        else { home.drawn++; away.drawn++; home.points += 1; away.points += 1; }
      }
    }
  }

  const table = Array.from(teams.values()).map((t) => ({
    ...t,
    goalDifference: t.goalsFor - t.goalsAgainst,
  }));

  table.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor);
  table.forEach((t, i) => { t.position = i + 1; });

  return table;
}

async function main() {
  log('Iniciando sesión en NFG...');
  await login();

  // Cargamos el data.json de la ejecución anterior (si existe) para
  // saltarnos jornadas cuya hora/campo ya conocíamos.
  let previousData = null;
  const previousRoundsByNumber = new Map();
  try {
    previousData = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
    for (const r of previousData.rounds || []) {
      previousRoundsByNumber.set(r.round, r);
    }
    log(`Datos previos cargados: ${previousData.rounds?.length || 0} jornadas.`);
  } catch (err) {
    log('No hay data.json previo (primera ejecución); se descargará todo desde cero.');
  }

  log('Descargando clasificación de Liga...');
  const clasificacion = await fetchClasificacion();
  log(`  -> ${clasificacion.standings.length} equipos`);
  await sleep(REQUEST_DELAY_MS);

  log('Descargando calendario completo de Liga (todas las jornadas)...');
  const ligaRounds = await fetchCalendario(CONFIG.liga.codCompeticion, CONFIG.liga.codGrupo);
  log(`  -> ${ligaRounds.length} jornadas`);
  await sleep(REQUEST_DELAY_MS);

  // Hora y campo: nos saltamos las jornadas que ya tenían todos sus
  // partidos jugados con hora/campo/acta conocidos en la ejecución
  // anterior. Solo se piden de nuevo las jornadas nuevas, incompletas, o
  // con algún partido pendiente de jugarse (para poder saber su hora en
  // cuanto se programe).
  function roundNeedsDetail(round) {
    const prev = previousRoundsByNumber.get(round.round);
    if (!prev) return true; // jornada que no teníamos antes
    for (const m of round.matches) {
      const prevMatch = (prev.matches || []).find((pm) => pm.homeTeam === m.homeTeam && pm.awayTeam === m.awayTeam);
      if (!prevMatch) return true;
      if (m.played && (!prevMatch.time || !prevMatch.venue || !prevMatch.codActa)) return true;
      if (!m.played) return true; // partido aún no jugado: puede cambiar de hora
    }
    return false;
  }

  const roundsToDetail = ligaRounds.filter(roundNeedsDetail).map((r) => r.round);
  const roundsSkipped = ligaRounds.length - roundsToDetail.length;

  log(`Descargando hora/campo de ${roundsToDetail.length} jornadas (${roundsSkipped} ya estaban completas y se omiten)...`);
  for (const roundNum of roundsToDetail) {
    try {
      const details = await fetchRoundDetail(CONFIG.liga.codCompeticion, CONFIG.liga.codGrupo, CONFIG.codTemporada, roundNum);
      const round = ligaRounds.find((r) => r.round === roundNum);
      if (round) mergeRoundDetail(round, details);
      await sleep(REQUEST_DELAY_MS);
    } catch (err) {
      log(`  -> jornada ${roundNum}: no se pudo obtener hora/campo (${err.message})`);
    }
  }
  // Para las jornadas que nos saltamos, copiamos directamente el
  // time/venue/codActa que ya teníamos guardado.
  for (const round of ligaRounds) {
    if (roundsToDetail.includes(round.round)) continue;
    const prev = previousRoundsByNumber.get(round.round);
    if (!prev) continue;
    for (const m of round.matches) {
      const prevMatch = (prev.matches || []).find((pm) => pm.homeTeam === m.homeTeam && pm.awayTeam === m.awayTeam);
      if (prevMatch) {
        m.time = prevMatch.time || null;
        m.venue = prevMatch.venue || null;
        m.codActa = prevMatch.codActa || null;
      }
    }
  }

  // Ficha completa (alineaciones, goles, tarjetas, árbitro) de TODOS los
  // partidos ya disputados de la jornada, no solo los del Sporting. Gracias
  // a la caché de arriba, en ejecuciones posteriores solo se piden las
  // actas nuevas (partidos que no teníamos todavía).
  log('Descargando fichas de partido (actas) de todos los partidos jugados...');
  const existingActaIds = await getExistingActaIds();
  log(`  -> ${existingActaIds.size} actas ya existentes en Firestore (se omiten)`);
  let actasNuevas = 0;
  let actasReutilizadas = 0;
  for (const r of ligaRounds) {
    for (const m of r.matches) {
      if (!m.played || !m.codActa) continue;
      if (existingActaIds.has(String(m.codActa))) {
        actasReutilizadas++;
        continue; // ya está en Firestore, no hace falta volver a pedirla ni reescribirla
      }
      try {
        m.acta = await fetchActa(m.codActa);
        actasNuevas++;
        await sleep(REQUEST_DELAY_MS);
      } catch (err) {
        log(`  -> acta ${m.codActa} (jornada ${r.round}): no se pudo descargar (${err.message})`);
      }
    }
  }
  log(`  -> ${actasNuevas} actas nuevas descargadas, ${actasReutilizadas} ya estaban en Firestore`);

  const ownTeamCalendar = extractOwnMatches(ligaRounds);

  log('Descargando goleadores de Liga...');
  const scorers = await fetchGoleadores();
  log(`  -> ${scorers.length} jugadores con gol`);
  await sleep(REQUEST_DELAY_MS);

  const playedRounds = ligaRounds.filter((r) => r.matches.some((m) => m.played));
  const lastPlayedRound = playedRounds[playedRounds.length - 1] || null;
  const lastRoundResults = lastPlayedRound
    ? lastPlayedRound.matches.map((m) => ({
        homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeGoals: m.homeGoals, awayGoals: m.awayGoals,
        time: m.time, venue: m.venue, codActa: m.codActa || null,
      }))
    : [];

  log('Escribiendo actas en Firestore (fuera del data.json público)...');
  const { written: actasWritten } = await writeActasToFirestore(ligaRounds);
  log(`  -> ${actasWritten} actas escritas/actualizadas en Firestore`);

  log('Escribiendo goleadores en Firestore (fuera del data.json público)...');
  await writeScorersToFirestore(scorers.slice(0, 20), scorers.filter((s) => s.isOwnTeam));

  log('Escribiendo hora de inicio de cada partido del Sporting en Firestore...');
  const { written: metaWritten } = await writeMatchMetaToFirestore(ownTeamCalendar, CONFIG.temporadaTexto);
  log(`  -> ${metaWritten} partidos con hora registrada`);

  // Versión pública del calendario: sin la ficha completa del partido (que
  // contiene alineaciones = nombres de jugadores). Esa vive solo en
  // Firestore, detrás de sesión iniciada. El código "codActa" se queda
  // (es solo un identificador numérico, no revela nada por sí mismo).
  const publicRounds = ligaRounds.map((r) => ({
    ...r,
    matches: r.matches.map(({ acta, ...rest }) => rest),
  }));

  const data = {
    generatedAt: new Date().toISOString(),
    team: { id: CONFIG.codEquipoPropio, name: CONFIG.nombreEquipoPropio },
    season: CONFIG.temporadaTexto,
    competition: {
      title: clasificacion.tituloCompeticion,
      season: `Temporada ${CONFIG.temporadaTexto}`,
      round: lastPlayedRound ? `Jornada ${lastPlayedRound.round} (${lastPlayedRound.date})` : null,
    },
    standings: clasificacion.standings,
    lastRoundResults,
    rounds: publicRounds,
    ownTeamCalendar,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2), 'utf-8');
  log(`Guardado en ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[scrape] ERROR:', err.message);
  process.exit(1);
});
