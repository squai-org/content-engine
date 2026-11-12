# Sistema de diseño

Los colores y la tipografía de los templates genéricos se definen en `templates/tokens.css`. Los templates Squai traen sus propios tokens.

Uso de cada template:

- `carrusel-squai.html`: carruseles de marca. El color cambia con el servicio de la pieza (Grow teal, Learn gold, One periwinkle). Usa `title` con una frase entre `[[ ]]`, `body` como apoyo, `note` como anotación a mano y `source` como fuente. No usa `kicker`.
- `reel-hyperframes.html`, `reel-remotion.tsx` y `reel-squai.html`: reels animados, una escena por lámina. Las reglas de video y cuándo usar cada uno están en `bases/sistema-de-video.md`.
- `editorial.html`: carruseles y posts con desarrollo.
- `afirmacion.html`: post de una sola frase de choque.
- `story.html`: stories.

Medidas de `carrusel-squai.html`: 1080×1350, márgenes de 80 px arriba y abajo y 180 px a los lados, contenido en 720 px de ancho. El título se ajusta solo para caber.
