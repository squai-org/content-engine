# Content Engine

Planea, produce, revisa y publica contenido de Instagram con agentes de Claude Code.

## Flujo

1. El planner crea las ideas de la semana.
2. El productor escribe el copy y genera las láminas, o las escenas del reel que el servidor anima y exporta en video.
3. Una persona revisa, anota ajustes y aprueba.
4. El sistema publica en la fecha programada.

Cada ejecución de un agente se ve en Actividad como una conversación, y se puede cancelar o reejecutar.

## Requisitos

- Node 22.18 o superior
- Claude Code con sesión iniciada
- Chromium
- ffmpeg y ffprobe, para exportar los reels
- Cuenta profesional de Instagram y una app de Meta

## Desarrollo local

```bash
cp .env.example .env
npm install
npm run build
npm start
```

## Servidor

Oracle Linux, Ubuntu o Debian, con acceso SSH y `sudo`.

1. En el servidor:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/squai-org/content-engine/main/deploy/install.sh -o install.sh
   sudo bash install.sh contenido.ejemplo.com
   ```
2. Anota la contraseña que imprime. Define `IG_APP_ID` e `IG_APP_SECRET` en `/etc/content-engine.env` y reinicia con `sudo systemctl restart content-engine`.
3. Inicia sesión de Claude una vez:
   ```bash
   sudo runuser -u contenido -- env HOME=/var/lib/content-engine/home claude
   ```
4. Abre los puertos 80 y 443 en la lista de seguridad de la red de Oracle (VCN). El instalador ya los abre en el firewall de la instancia.

Para un repo privado, usa `REPO=git@github.com:squai-org/content-engine.git`: el instalador genera una llave que debes agregar como Deploy key de solo lectura.

## Actualizar

```bash
ssh usuario@servidor sudo content-engine-deploy
```

Para una versión concreta: `content-engine-deploy <sha>`. Si el servicio no responde tras el despliegue, vuelve solo a la versión anterior.

El despliegue instala ffmpeg si falta y actualiza la unidad de systemd. Los archivos nuevos de `seed` se copian a `data/workspace` al arrancar. Un archivo de `seed` que cambió solo se actualiza si nadie lo editó en el servidor.

## Operación

| Tarea | Comando |
| --- | --- |
| Logs | `journalctl -u content-engine -f` |
| Respaldo | Diario a las 03:00 en `/var/backups/content-engine`, 14 días |
| Descargar respaldos | `scp usuario@servidor:/var/backups/content-engine/* .` |

## Conectar Instagram

La cuenta debe ser Empresa o Creador. Usa Unified Login de Meta; no requiere página de Facebook.

1. En developers.facebook.com crea una app con el caso de uso Instagram API.
2. En Instagram API, API setup with Unified login, crea una configuración y registra como Redirect URL la que muestra la sección Conexiones.
3. En App roles, Roles, agrega la cuenta como Instagram Tester y acepta la invitación desde Instagram.
4. En el servidor define `IG_APP_ID` y `IG_APP_SECRET` (App settings, Basic) e `IG_CONFIG_ID` (Configuration ID). Reinicia.
5. En Conexiones, pulsa Conectar.

Si Meta no asigna ninguna cuenta, edita la misma configuración en Facebook Login for Business, Configurations, agrega `business_management` y vuelve a conectar.

## Templates

Un template es un HTML con dos etiquetas `meta`: `size` (por ejemplo `1080x1350`) y `formats` (`post`, `carrusel`, `story`, `reel`). La sección Templates lo muestra con contenido de muestra y permite editarlo con vista previa en vivo.

| Marcador | Contenido |
| --- | --- |
| `{{kicker}}`, `{{title}}`, `{{body}}`, `{{note}}`, `{{source}}` | Texto de la lámina. `[[frase]]` en `title` o `body` sale como `<mark>`. |
| `{{index}}`, `{{total}}`, `{{position}}` | Número de lámina, total y `first`, `middle`, `last` o `single`. |
| `{{service}}` | Servicio de la pieza. |
| `{{tokens}}` | Contenido de `tokens.css`. |

### Reels

Los reels se exportan con [HyperFrames](https://github.com/heygen-com/hyperframes): el template es un HTML con una línea de tiempo de GSAP registrada en `window.__timelines`, y HyperFrames la recorre cuadro a cuadro hasta un MP4 a 30 fps. Un template de reel lleva `<meta name="engine" content="hyperframes">`.

Cada lámina es una escena. El template recibe en `{{data}}` el objeto `service`, `duration` y `scenes` (`kicker`, `title`, `body`, `note`, `source`, `start`, `seconds`), y la duración total en `{{duration}}`.

En Templates, la vista previa de un reel tiene controles de reproducción, y «Exportar muestra» genera un MP4 de prueba. El aviso del render aparece en toda la app.

HyperFrames usa licencia Apache 2.0 y GSAP su licencia estándar sin costo.

### Video grabado

Un reel admite una grabación subida desde la pieza. Al subirla, el productor corre de nuevo y la ejecución hace cuatro pasos, visibles en Actividad:

1. Convierte el video a 1080×1920, 30 fps, H.264. El original se borra.
2. Transcribe el audio palabra por palabra con Whisper local, a través de `hyperframes transcribe`.
3. El agente recibe la transcripción y devuelve el plan de edición: recorte, correcciones, palabras resaltadas, título, animaciones y cierre.
4. HyperFrames compone el video sobre la grabación.

Los templates de video grabado llevan `<meta name="footage" content="si">` y reciben además `footage` (`src` y `start`) y `edit` (`hook`, `cta`, `words`, `captions`, `moments`). En HyperFrames, `{{footage}}` y `{{media_start}}` llenan la etiqueta `video`.

La primera transcripción compila whisper.cpp y descarga el modelo (unos 500 MB con `small`) en la carpeta del usuario del servicio. Necesita `cmake`, un compilador de C++ y salida a `huggingface.co`.

## Límites de Oracle

La sección Servidor muestra procesador, memoria, disco y tráfico de salida frente a la capa gratuita: 4 OCPU, 24 GB de memoria, 200 GB de almacenamiento y 10 TB de salida al mes. Los agentes corren de uno en uno, el servicio queda limitado a 3,5 núcleos y 20 GB, cada pieza conserva solo los archivos de su última versión y los agentes se pausan si quedan menos de 2 GB libres.

## Permisos de Meta

| Función | Permiso |
| --- | --- |
| Publicar | `instagram_basic`, `instagram_content_publish` |
| Analítica | `instagram_manage_insights` |
| Primer comentario | `instagram_manage_comments` |

## Variables

| Variable | Uso |
| --- | --- |
| `HOST` | Interfaz donde escucha. Por defecto `127.0.0.1`. |
| `PUBLIC_URL` | URL pública del servidor. Instagram descarga las piezas desde aquí. |
| `ADMIN_PASSWORD` | Contraseña de la interfaz. |
| `SESSION_SECRET` | Secreto de la sesión. |
| `TIMEZONE` | Zona horaria de los hooks semanales. |
| `CLAUDE_BIN` | Ruta de Claude Code. |
| `CHROMIUM_PATH` | Ruta de Chromium. |
| `FFMPEG_PATH` | Ruta de ffmpeg. Por defecto `ffmpeg`. |
| `TRANSCRIBE_MODEL` | Modelo de Whisper. Por defecto `small`. `medium` acierta más y tarda más. |
| `TRANSCRIBE_LANGUAGE` | Idioma del audio. Por defecto `es`. |
| `HEADLESS_SHELL_PATH` | Ruta de Chrome Headless Shell para HyperFrames. Por defecto usa el que instala Playwright. |
| `IG_APP_ID` | App ID de Meta. |
| `IG_APP_SECRET` | App secret de Meta. |
| `IG_CONFIG_ID` | Configuration ID de Unified Login. |

## Estructura

| Ubicación | Contenido |
| --- | --- |
| `src/server` | API, cola, agentes, render de láminas y video, monitor y publicador |
| `src/web` | Interfaz |
| `deploy` | Instalador, despliegue, respaldo y servicios |
| `seed` | Agentes, skills, bases y templates iniciales |
| `data` | Base de datos, piezas y copia editable de `seed` |

## Pruebas

```bash
npm test
npm run typecheck
```
