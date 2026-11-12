# Pendientes de seguridad

| Pendiente | Riesgo | Acción |
| --- | --- | --- |
| Límite de intentos en el login | `POST /api/login` solo espera 300 ms por intento. Permite fuerza bruta contra `ADMIN_PASSWORD`. | Bloquear por IP tras 5 fallos en 15 minutos. |
| `/media/` público | Instagram necesita descargar las piezas. Quien tenga el enlace ve piezas aún no publicadas. Los nombres llevan UUID. | URLs con firma y expiración, o borrar los archivos tras publicar. |
| SSH abierto a `0.0.0.0/0` | Intentos de acceso constantes. La autenticación por contraseña está desactivada, verificado con `sshd -T`. | Opcional: limitar el origen a una IP fija o usar el servicio Bastion de Oracle. |
| Token de Instagram en claro | Se guarda en SQLite y entra en los respaldos, que quedan con permisos 600. | Cifrarlo con una clave derivada de `SESSION_SECRET`. |

## Regla que debe mantenerse

Los agentes solo tienen herramientas de lectura y búsqueda web (`Read`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `Skill`). El contenido de la web no es confiable y puede traer instrucciones ocultas. Mientras los agentes no puedan escribir archivos ni ejecutar comandos, el impacto queda acotado. No agregar `Bash`, `Write` ni `Edit` a `TOOLS` en `src/server/agents.ts`.
