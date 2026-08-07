/**
 * Scraper para el Sporting de Maderasa - Bar Juanjo
 * -------------------------------------------------
 * Inicia sesión en la intranet NFG de FFMadrid (aranjuez.ffmadrid.es) con las
 * credenciales del club y descarga:
 *   - Clasificación del grupo
 *   - Resultados de la última jornada
 *   - Tabla de goleadores del grupo
 *
 * Guarda todo en data/data.json, que luego lee la web estática (site/).
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

// ---- Configuración del club / competición -------------------------------
// Estos códigos son específicos de la Liga Local de Aranjuez y de tu equipo.
// Si el año que viene cambian de competición/grupo, solo hay que actualizar
// estos valores (se pueden ver navegando la web de FFMadrid con las
// credenciales del club, en la URL de "Clasificación").
const CONFIG = {
  baseUrl: 'https://aranjuez.ffmadrid.es',
  codPrimaria: '1000128',
  codCompeticion: '1009587', // LIGA AFICIONADOS F-11
  codGrupo: '1009591', // 1ª AFICIONADOS F-11
  codTemporada: '21', // 2025-2026
  codEquipoPropio: '1000030', // SPORTING DE MADERASA - BAR JUANJO
  nombreEquipoPropio: 'SPORTING DE MADERASA - BAR JUANJO',
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

async function login() {
  const user = process.env.NFG_USER;
  const pass = process.env.NFG_PASS;

  if (!user || !pass) {
    throw new Error(
      'Faltan las variables de entorno NFG_USER y/o NFG_PASS con las credenciales del club.'
    );
  }

  // 1. Visitamos la home para que el servidor nos asigne cookie de sesión.
  await client.get(`${CONFIG.baseUrl}/nfg/`);

  // 2. Hacemos login por POST, igual que hace el formulario NLogin del sitio.
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

// ---- Clasificación --------------------------------------------------------
async function fetchClasificacion() {
  const url = `${CONFIG.baseUrl}/nfg/NPcd/NFG_VisClasificacion`;
  const resp = await client.get(url, {
    params: {
      cod_primaria: CONFIG.codPrimaria,
      codgrupo: CONFIG.codGrupo,
      codcompeticion: CONFIG.codCompeticion,
    },
  });

  const $ = cheerio.load(resp.data);

  // Título de la competición/grupo (p.ej. "LIGA AFICIONADOS F-11, 1ª AFICIONADOS F-11")
  const tituloCompeticion = $('td.titulocaja').first().text().trim();
  const temporadaTexto = $('.titulocaja')
    .filter((_, el) => /Temporada/i.test($(el).text()))
    .first()
    .text()
    .trim();

  // Jornada mostrada por defecto (última jugada), p.ej. "Jornada 22 (17-05-2026)"
  const jornadaTexto = $('.title_categoría').first().text().trim();

  // --- Resultados de la última jornada (tabla resumen en la cabecera) ---
  const lastRoundResults = [];
  $('table.table.table-striped.table-hover.table-bordered')
    .first()
    .find('tr')
    .each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 4) return; // saltar filas de cabecera

      const homeLink = $row.find('td').eq(0).find('a');
      const awayLink = $row.find('td').eq(2).find('a');
      if (!homeLink.length || !awayLink.length) return;

      const scoreText = $row.find('td').eq(1).text().replace(/\s+/g, ' ').trim();
      const scoreMatch = scoreText.match(/(\d+)\s*-\s*(\d+)/);

      lastRoundResults.push({
        homeTeam: homeLink.text().trim(),
        homeTeamId: (homeLink.attr('href') || '').match(/Codigo_Equipo=(\d+)/)?.[1] || null,
        awayTeam: awayLink.text().trim(),
        awayTeamId: (awayLink.attr('href') || '').match(/Codigo_Equipo=(\d+)/)?.[1] || null,
        homeGoals: scoreMatch ? Number(scoreMatch[1]) : null,
        awayGoals: scoreMatch ? Number(scoreMatch[2]) : null,
      });
    });

  // --- Tabla de clasificación resumida (span#CL_Resumen, filas *_2) ---
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

  return {
    tituloCompeticion,
    temporadaTexto,
    jornadaTexto,
    lastRoundResults,
    standings,
  };
}

// ---- Goleadores -------------------------------------------------------
async function fetchGoleadores() {
  const url = `${CONFIG.baseUrl}/nfg/NPcd/NFG_CMP_Goleadores`;
  const resp = await client.get(url, {
    params: {
      cod_primaria: CONFIG.codPrimaria,
      codcompeticion: CONFIG.codCompeticion,
      codgrupo: CONFIG.codGrupo,
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
        isOwnTeam: team.toUpperCase().includes(CONFIG.nombreEquipoPropio),
      });
    });

  // Ya vienen ordenados por goles desc en la web, pero por seguridad:
  scorers.sort((a, b) => b.goals - a.goals);

  return scorers;
}

async function main() {
  log('Iniciando sesión en NFG...');
  await login();

  log('Descargando clasificación y resultados...');
  const clasificacion = await fetchClasificacion();
  log(`  -> ${clasificacion.standings.length} equipos, ${clasificacion.lastRoundResults.length} resultados`);

  log('Descargando goleadores...');
  const scorers = await fetchGoleadores();
  log(`  -> ${scorers.length} jugadores con gol`);

  const data = {
    generatedAt: new Date().toISOString(),
    team: {
      id: CONFIG.codEquipoPropio,
      name: CONFIG.nombreEquipoPropio,
    },
    competition: {
      title: clasificacion.tituloCompeticion,
      season: clasificacion.temporadaTexto,
      round: clasificacion.jornadaTexto,
    },
    standings: clasificacion.standings,
    lastRoundResults: clasificacion.lastRoundResults,
    topScorers: scorers.slice(0, 20),
    ownTeamScorers: scorers.filter((s) => s.isOwnTeam),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2), 'utf-8');
  log(`Guardado en ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[scrape] ERROR:', err.message);
  process.exit(1);
});
