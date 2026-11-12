# Sistema de video

Reglas para los reels. El productor escribe las escenas y elige un template de reel; el servidor las anima y exporta el video.

## Formato

| Red | Tamaño | Duración | Archivo |
| --- | --- | --- | --- |
| Instagram Reels | 1080×1920, 9:16 | 15 a 40 segundos | MP4, H.264, 30 fps, AAC |

## Templates

| Template | Úsalo para |
| --- | --- |
| `reel-hyperframes.html` | Reels animados desde el guion, sin grabación |
| `video-hyperframes.html` | Reels sobre un video grabado, con subtítulos y animaciones |

## Zonas seguras

- Arriba: 290 px libres para el encabezado de la app.
- Abajo: 460 px libres para el pie, los botones y la descripción.
- Lados: 90 px.

Todo el texto vive dentro de esa área. El template ya la respeta.

## Estructura

1. Escena 1, gancho: la tesis o la tensión en menos de 8 palabras. Debe entenderse en los primeros 3 segundos.
2. Escenas intermedias: una idea por escena.
3. Escena final: la llamada a la acción. El template agrega `squai.io`.

Entre 3 y 9 escenas. La duración de cada una la calcula el servidor según la cantidad de palabras: entre 2,5 y 7 segundos.

## Texto en pantalla

- La mayoría ve el reel sin sonido: el texto en pantalla cuenta la historia completa.
- `title`: máximo 9 palabras. Una sola frase resaltada con `[[ ]]`.
- `body`: máximo 16 palabras. Opcional.
- `kicker`: etiqueta de 1 a 3 palabras. Opcional.
- `note`: comentario breve a mano. Opcional, máximo en dos escenas.
- Sin emojis.

## Movimiento

- Las palabras del título entran una por una, de abajo hacia arriba.
- El resaltado se dibuja después del título.
- La transición entre escenas dura menos de medio segundo y no tapa el texto. La barra superior marca el avance.
- El movimiento acompaña la lectura: nada se mueve mientras el lector lee el cuerpo.
- Primera y última escena llevan el color del servicio; las demás, fondo claro.

## Color

Sigue el servicio de la pieza: Grow teal, Learn gold, One periwinkle. Texto siempre Midnight.

## Video grabado

Cuando la pieza trae una grabación, el servidor la convierte a 1080×1920, la transcribe y el productor planifica la edición con la skill edicion-video. El template es `video-hyperframes.html`.

| Elemento | Regla |
| --- | --- |
| Duración | Entre 15 y 90 segundos después del recorte. La grabación se lee hasta 3 minutos |
| Título inicial | Primeros 3 segundos, arriba. Máximo 9 palabras, una frase resaltada |
| Subtítulos | Siempre. Hasta 3 palabras por línea, centrados bajo la mitad de la pantalla, fuera de la zona del pie. Cada palabra se enciende al decirse |
| Resaltado | Una o dos palabras por frase, en el color de resaltado del servicio |
| Etiqueta | 1 a 3 palabras sobre el concepto que se acaba de nombrar. Dura unos 2 segundos |
| Nota a mano | Comentario breve. Máximo dos por video |
| Acercamiento | En afirmaciones fuertes o cambios de idea. Suave, 14 % |
| Ritmo | Una animación cada 5 a 8 segundos. Nunca dos a la vez |
| Cierre | Últimos 2,6 segundos: tarjeta con la llamada a la acción y `squai.io` |
| Audio | Se conserva la voz original |

Para publicar un video ya editado por fuera, usa «Subir video propio» en la pieza: se publica tal cual.
