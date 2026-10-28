# Carga y navegación del mapa

Medido el 28/10/2026 con MapTiler real, el estilo configurado en `.env.local` y `next build` + `next start` en localhost. Chromium headless con WebGL por software, sin limitar la red, contextos de navegador nuevos. Estos resultados locales no garantizan los tiempos de Vercel ni de otras conexiones.

| Medición | Escritorio 1440 × 1000 | Móvil 390 × 844 |
| --- | ---: | ---: |
| Librería disponible, desde inicio | 79 ms | 119 ms |
| Estilo recibido y parseado, desde inicio | 304 ms | 135 ms |
| Construcción de instancia | 16 ms | 16 ms |
| Tiles, fuentes y renderizado hasta `load` | 2028 ms | 2111 ms |
| Total hasta mapa preparado | **2349 ms** | **2263 ms** |

Las descargas de librería y estilo son paralelas; las filas no se suman. La fase de tiles/fuentes incluye red externa, trabajo del worker y renderizado: no debe interpretarse como latencia exclusiva del proveedor. No se obtuvo una línea base comparable anterior, por lo que no se afirma una mejora porcentual.

Una segunda ejecución completa midió **3463 ms en escritorio** (librería 74 ms, estilo 114 ms, construcción 2362 ms y tiles/render 986 ms) y **1709 ms en móvil** (75, 286, 21 y 1399 ms, respectivamente). La construcción de WebGL por software puede variar considerablemente: esta muestra muestra que una demora también puede estar en la inicialización gráfica local, no solo en la red. El rango observado en estas cuatro muestras fue de **1,7 a 3,5 segundos**.

En las verificaciones con cartografía real, la home no descargó el chunk del dashboard, la selección de las cinco ciudades no repitió la solicitud del estilo y no se emitieron peticiones meteorológicas. Al volver desde el dashboard se monta de nuevo el mapa; esto es un nuevo montaje deliberado, no dos instancias simultáneas.

## Causas y correcciones

- La home anterior cargaba y montaba todo el dashboard junto al mapa. Ahora el dashboard tiene un chunk independiente, se carga al entrar y se mantiene una única instancia para preservar trabajo al navegar.
- Antes, la petición del estilo empezaba después de importar MapLibre. Ahora ambas descargas comienzan en paralelo y se hace preconexión al origen configurado.
- El límite anterior de 25 segundos empezaba después de crear el mapa. El nuevo límite de 15 segundos empieza antes de descargar librería y estilo; al vencer cancela la petición, libera el mapa y ofrece selección de ciudades y reintento.
- Se conserva el worker local versionado, necesario para MapLibre 6 con Turbopack. Se usan dos workers, cero animaciones de cámara y `fadeDuration: 0`.
- La selección de ciudad actualiza botones/popup sin recrear el mapa ni solicitar meteorología. El estilo configurado se conserva.

## Instrumentación

`performance.getEntriesByType("measure")` permite revisar entradas con prefijo `meteolab:map:`. Cada intento emite el evento `meteolab:map-metrics` y un resumen de consola con `library`, `style`, `instance`, `tilesAndFonts`, `total` y `outcome`. No se registran URLs ni claves.

La instrumentación distingue descarga/parseo del estilo de descarga del JavaScript y construcción de la instancia. Si el total se concentra en la fase de tiles/fuentes, conviene contrastarlo con Network del navegador y con el proveedor, sin atribuir toda esa fase a MapTiler.

## Verificación

Las pruebas automatizadas cubren los cinco popups y sus ciudades de destino, ausencia de extracción automática, persistencia de una extracción en curso y filas seleccionadas al volver al mapa, reintento sin mapas duplicados y fallback a los 15 segundos. Los escenarios ETL existentes se ejecutan ahora en `/dashboard` y conservan sus pruebas de lotes, snapshot y reintentos. El estilo de las pruebas funcionales es controlado; los tiempos de la tabla se obtuvieron con cartografía real en la versión que se midió.
