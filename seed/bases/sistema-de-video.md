# Sistema de video

Reglas para los reels. El productor escribe las escenas; el servidor las anima con `templates/reel-squai.html` y exporta el video.

## Formato

| Red | Tamaño | Duración | Archivo |
| --- | --- | --- | --- |
| Instagram Reels | 1080×1920, 9:16 | 15 a 40 segundos | MP4, H.264, 30 fps, AAC |

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
- Cada escena cambia por corte. La barra superior marca el avance.
- Primera y última escena llevan el color del servicio; las demás, fondo claro.

## Color

Sigue el servicio de la pieza: Grow teal, Learn gold, One periwinkle. Texto siempre Midnight.

## Video grabado

Si la pieza necesita video grabado, súbelo desde la pieza. El archivo subido reemplaza al video animado.
