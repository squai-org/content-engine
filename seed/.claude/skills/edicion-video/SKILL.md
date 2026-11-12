---
name: edicion-video
description: Plan de edición de un reel a partir de un video grabado y su transcripción, con subtítulos, título y animaciones.
---

# Edición de video grabado

Recibes la transcripción del video palabra por palabra, con índice y segundo de inicio. No ves la imagen: decides con lo que se dice y cuándo se dice. El servidor corta, subtitula, anima y exporta.

1. Lee `bases/sistema-de-video.md`, sección Video grabado. Sus límites son obligatorios.
2. Lee la transcripción completa antes de decidir. Ubica la tesis, los giros y el cierre.
3. `trim`: el video final empieza en la primera palabra útil y termina al cerrar la última idea. Quita arranques en falso, muletillas iniciales y silencio final. Deja medio segundo después de la última palabra. No cortes a mitad de frase.
4. `fixes`: corrige lo que el transcriptor oyó mal. Nombres propios y de productos, palabras pegadas, tildes, signos de apertura y puntuación. Si una palabra suena absurda en el contexto, es un error de transcripción: corrígela por lo que la persona dijo. No cambies el sentido ni mejores la redacción.
5. `emphasis`: resalta entre una y dos palabras por frase, las que cargan el significado. Nunca artículos ni conectores.
6. `hook`: lo que se lee en los primeros tres segundos. Promete lo que el video responde. Máximo 9 palabras y una frase entre `[[ ]]`. No repite literal la primera frase hablada.
7. `moments`: una animación cada 5 a 8 segundos, anclada a la palabra que la motiva.
   - `keyword`: etiqueta de 1 a 3 palabras que nombra el concepto que se acaba de decir.
   - `note`: comentario breve a mano, con el tono de la marca. Máximo dos por video.
   - `zoom`: acercamiento en una afirmación fuerte o un cambio de idea. Lleva `text` vacío.
   Ninguna animación en los primeros tres segundos ni en los últimos tres: ahí van el título y el cierre.
8. `cta`: la única llamada a la acción de la pieza, en una línea de máximo 8 palabras.
9. `script`: la transcripción corregida, en párrafos.
10. `template`: un template de video grabado. Escribe solo el nombre del archivo.
11. Sin emojis en `hook`, `moments` ni `cta`.

El `copy` sigue la skill copy-instagram y no repite el guion: lo resume y lleva a la acción.
