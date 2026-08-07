# Sporting de Maderasa - Bar Juanjo

Web del equipo con la clasificación, resultados y goleadores de la Liga Local
de Fútbol Aficionado de Aranjuez, extraídos automáticamente de la intranet
NFG de FFMadrid (`aranjuez.ffmadrid.es`).

- **`docs/`** → la web en sí (HTML/CSS/JS estático). Es lo que se publica.
- **`scraper/`** → script Node.js que inicia sesión con las claves del club
  y descarga clasificación, resultados y goleadores a `docs/data/data.json`.
- **`.github/workflows/scrape.yml`** → tarea programada (gratis, con GitHub
  Actions) que ejecuta el scraper todos los días y publica los datos nuevos.

Todo el alojamiento es **gratuito**: GitHub Pages para la web y GitHub
Actions para la actualización automática de datos. No hace falta ningún
servidor propio.

## 1. Sube este proyecto a GitHub

1. Crea un repositorio nuevo en GitHub (puede ser público o privado; si es
   privado, GitHub Pages requiere una cuenta con Pages habilitado para repos
   privados, así que lo más sencillo es hacerlo público).
2. Sube el contenido de esta carpeta a ese repositorio:

   ```bash
   cd sporting-maderasa
   git init
   git add .
   git commit -m "Primera versión de la web"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```

## 2. Configura las credenciales del club como secretos

El scraper necesita el usuario y la clave con los que entras en
`aranjuez.ffmadrid.es`. **Nunca los pongas en el código** — se guardan como
"Secrets" cifrados de GitHub Actions:

1. En tu repositorio de GitHub, ve a **Settings → Secrets and variables →
   Actions → New repository secret**.
2. Crea un secreto llamado `NFG_USER` con tu usuario de acceso.
3. Crea otro llamado `NFG_PASS` con tu clave.

## 3. Activa GitHub Pages

1. En **Settings → Pages**.
2. En "Build and deployment" → "Source", elige **Deploy from a branch**.
3. En "Branch", selecciona `main` y la carpeta **`/docs`**.
4. Guarda. En un par de minutos tu web estará publicada en
   `https://TU_USUARIO.github.io/TU_REPO/`.

## 4. Lanza el scraper por primera vez

El workflow se ejecuta solo todos los días a las 07:00 UTC, pero puedes
lanzarlo a mano ahora mismo:

1. Ve a la pestaña **Actions** de tu repositorio.
2. Selecciona el workflow **"Actualizar datos del club"**.
3. Pulsa **Run workflow**.

Cuando termine (1-2 minutos), habrá hecho commit del `docs/data/data.json`
actualizado y GitHub Pages se refrescará solo.

## Actualizar cada temporada

Los códigos de competición, grupo y equipo de la Liga Local cambian de una
temporada a otra. Si el año que viene el scraper deja de encontrar datos (o
encuentra los de otro equipo/grupo), solo hay que editar el bloque `CONFIG`
al principio de `scraper/scrape.js`:

```js
const CONFIG = {
  codPrimaria: '1000128',
  codCompeticion: '1009587', // <- cambia esto
  codGrupo: '1009591',       // <- y esto
  codTemporada: '21',        // <- y esto
  codEquipoPropio: '1000030',
  ...
};
```

Los valores correctos se obtienen navegando la web de FFMadrid con tu clave
de acceso y mirando los parámetros de la URL en la página de
"Clasificación" del grupo del equipo (`codcompeticion=`, `codgrupo=`, etc.).

## Desarrollo / pruebas en local

```bash
npm install
NFG_USER=tu_usuario NFG_PASS=tu_clave npm run scrape
```

Esto regenera `docs/data/data.json`. Para ver la web en el navegador, basta
con abrir `docs/index.html`, o servir la carpeta con cualquier servidor
estático, por ejemplo:

```bash
npx serve docs
```

## Notas

- El repositorio ya incluye un `docs/data/data.json` de ejemplo (con los
  datos reales de la última jornada disponible al crear este proyecto), así
  que la web funciona nada más publicarla, aunque el scraper aún no se haya
  ejecutado.
- Si `aranjuez.ffmadrid.es` cambia su estructura HTML en el futuro, el
  scraper (`scraper/scrape.js`) es el único sitio que habría que retocar;
  la web (`docs/`) no depende de esos detalles, solo lee `data.json`.
