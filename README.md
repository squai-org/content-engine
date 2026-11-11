# Content Engine

Planea, produce, revisa y publica contenido de Instagram con agentes de Claude Code.

## Flujo

1. El planner crea las ideas de la semana.
2. El productor escribe el copy y genera las láminas.
3. Una persona revisa, anota ajustes y aprueba.
4. El sistema publica en la fecha programada.

## Requisitos

- Node 22.18 o superior
- Claude Code con sesión iniciada
- Chromium
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

## Operación

| Tarea | Comando |
| --- | --- |
| Logs | `journalctl -u content-engine -f` |
| Respaldo | Diario a las 03:00 en `/var/backups/content-engine`, 14 días |
| Descargar respaldos | `scp usuario@servidor:/var/backups/content-engine/* .` |

## Conectar Instagram

1. Crea una app en developers.facebook.com y agrega el producto API de Instagram con inicio de sesión de Instagram.
2. En la configuración del producto, pega la URL de redirección que muestra la sección Conexiones.
3. Agrega la cuenta como probador de la app y acepta la invitación desde Instagram.
4. Define `IG_APP_ID` e `IG_APP_SECRET` y reinicia.
5. En Conexiones, pulsa Conectar. El token se guarda y se renueva solo.

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
| `IG_APP_ID` | Id de la app de Meta. |
| `IG_APP_SECRET` | Secreto de la app de Meta. |

## Estructura

| Ubicación | Contenido |
| --- | --- |
| `src/server` | API, cola, agentes, render y publicador |
| `src/web` | Interfaz |
| `deploy` | Instalador, despliegue, respaldo y servicios |
| `seed` | Agentes, skills, bases y templates iniciales |
| `data` | Base de datos, piezas y copia editable de `seed` |

## Pruebas

```bash
npm test
npm run typecheck
```
