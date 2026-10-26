# MeteoLab · Primera práctica ETL

Aplicación en Next.js 16, React, TypeScript, Tailwind y el botón shadcn existente. Interfaz en castellano, sin datos ficticios en el flujo principal.

## Instalación y ejecución

Requiere Node.js 24 (las pruebas unitarias usan soporte nativo de TypeScript).

```bash
npm install
npm run dev -- --hostname localhost
```

Abre http://localhost:3000. El flujo de Supabase solo funciona en desarrollo local. `npm run build` compila correctamente; `npm start` sirve la interfaz, pero los endpoints de destino rechazan peticiones en producción hasta incorporar autenticación y autorización. No expongas el servidor de desarrollo a Internet.

## Supabase

1. Copia `.env.example` a `.env.local` sin sobrescribir credenciales existentes.
2. Configura `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (o `SUPABASE_SERVICE_ROLE_KEY`). También se admite la URL existente `NEXT_PUBLIC_SUPABASE_URL`. La clave pública no sirve para escribir desde este flujo.
3. Ejecuta `supabase/migrations/202610260001_mediciones.sql` desde el editor SQL del proyecto Supabase, o con tu flujo habitual de migraciones. No se requiere una clave pública en el navegador.
4. Reinicia el servidor tras cambiar variables.

La tabla tiene identidad, clave única `(ciudad, fecha_hora)`, restricciones de calidad, índice de fecha y RLS activado. No se crean políticas públicas de escritura. La clave privilegiada se utiliza exclusivamente en módulos del servidor. Los endpoints validan origen local, filas, lotes de hasta 500 y cuerpo de hasta 180.000 bytes, incluso sin Content-Length. Antes de publicar hay que sustituir el bloqueo de producción por autenticación y autorización reales, además de límites por usuario.

## Recorrido didáctico

- **Extracción:** cinco ciudades disponibles; inicialmente Barcelona, del 1 al 30 de septiembre de 2026. Máximo 31 días inclusivos. Se solicitan horas UTC, °C y mm. Estado, tiempo y error individual por ciudad; los reintentos conservan el periodo original y reemplazan su respuesta, sin concatenarla.
- **Transformación:** comprueba arrays paralelos y UTC, y crea una fila por ciudad/hora. Una respuesta estructuralmente incoherente se señala como error de transformación, permanece disponible como JSON y no se procesa parcialmente.
- **Limpieza:** exige fechas UTC válidas y mediciones numéricas finitas; no convierte null ni cadenas en cero. Humedad entre 0 y 100, precipitación no negativa, sin umbrales arbitrarios de temperatura. Conserva la primera fila válida de cada clave; los duplicados posteriores aparecen entre los rechazados con su motivo.
- **Filtrado y selección:** filtros por ciudades, intervalo UTC, rangos de las tres mediciones y lluvia > 0. Se filtra y ordena antes de paginar (25 filas). «Seleccionar todas» abarca todas las páginas. Cambiar filtros no selecciona filas nuevas; se informa de las seleccionadas que quedan fuera. Los descartes de calidad se separan de las exclusiones por filtros.
- **Carga:** la vista previa es la intersección de selección y filtros, con el orden elegido. Al comenzar se copia el conjunto. Envíos secuenciales de hasta 500 filas mediante upsert. Cada lote consulta después las claves de destino en grupos de 40. Si falla una escritura o verificación, el lote queda fallido y puede reintentarse sin reenviar los completados. El informe cuenta filas procesadas y verificadas; no inventa inserciones frente a actualizaciones. Un fallo de verificación puede suceder después de una escritura efectiva: el reintento es idempotente por la clave única.
- **Consulta del destino:** pestaña independiente con lectura real, paginación, ciudad, fechas, orden y actualización explícita. La base de datos no garantiza orden de inserción; las consultas especifican ORDER BY.

Las respuestas JSON originales y la carga congelada viven en memoria durante la sesión de la página: se pierden al recargar o cerrar. El visor JSON limita el texto a 16.000 caracteres; la descarga conserva la respuesta completa. Una nueva extracción reemplaza la sesión anterior.

## Verificación

```bash
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

Playwright usa Chromium (`npx playwright install chromium` si no está instalado). Puede reutilizar un servidor local ya abierto o iniciar uno. La prueba de extracción real necesita Internet; los otros escenarios interceptan las peticiones exclusivamente dentro del navegador de pruebas.

Verificado en esta entrega:

- Extracción **real** de Barcelona, 01/09/2026: 24 horas, desplazamiento UTC 0.
- Fixtures unitarios aislados: arrays, fechas imposibles, null, cadenas, duplicados, filtros, ordenación, selección entre páginas y preview.
- Navegador: pantalla de escritorio y móvil de 390 px sin desbordamiento horizontal; extracción real, selección y preview; rechazo de peticiones incompletas en servidor.
- Fixture de 720 filas: dos lotes (500 + 220), fallo parcial, conservación del lote correcto, reintento de las 220 fallidas y snapshot inmutable al cambiar filtros.
- Reintento de una ciudad sin volver a solicitar las correctas ni mezclar periodos.
- Build de producción, tipos y lint.

**Integración pendiente:** el proyecto Supabase configurado responde, pero la tabla `mediciones_meteorologicas` no existe (respuesta 404). Se incluye la migración, sin fingir una carga correcta. Hasta aplicarla quedan pendientes la carga real, su verificación de claves y una segunda carga real sin duplicados. Las pruebas controladas de navegador no sustituyen esa integración.

## Documentación oficial consultada

- [API histórica de Open-Meteo](https://open-meteo.com/en/docs/historical-weather-api): variables horarias, unidades y UTC.
- [Upsert de Supabase](https://supabase.com/docs/reference/javascript/upsert): resolución por clave única.
- [REST de Supabase](https://supabase.com/docs/guides/api): acceso REST desde servidor.
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): protección de tablas.

El acceso a Supabase se implementa mediante REST con fetch, sin una dependencia adicional del SDK.
