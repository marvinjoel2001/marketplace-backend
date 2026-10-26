# TikTok LIVE para Vitrina Market

El módulo `src/modules/tiktok-lives/` está registrado en `AppModule`. El endpoint público consulta Redis o SQLite; nunca ejecuta scraping dentro de una petición del frontend. Los lives de demostración existentes en `LiveStream` no se convierten en transmisiones reales.

## Configuración y ejecución

Requisitos: Node.js 22.12+, Chrome/Chromium y Redis para varias instancias (Puppeteer 25 requiere Node 22.12+).

1. Instalar dependencias con `npm ci`. Para usar Chrome ya instalado, configurar `PUPPETEER_EXECUTABLE_PATH` y usar `PUPPETEER_SKIP_DOWNLOAD=true` al instalar. Alternativamente: `npx puppeteer browsers install chrome`.
2. Respaldar SQLite, ejecutar `npm run prisma:generate` y aplicar las tablas nuevas mediante `npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/tiktok-lives.sql`. El SQL es aditivo. Bases creadas antes de las previsualizaciones: aplicar una vez `prisma/sql/tiktok-lives-preview.sql` del mismo modo. Para una base nueva, usar el flujo existente `npm run prisma:push`.
3. Copiar las variables `TIKTOK_*` de `.env.example` a `.env`. Configurar `TIKTOK_REDIS_URL` (p. ej. `redis://127.0.0.1:6380/0` para Redis del compose). Sin URL se utiliza memoria para **una instancia**, indicada en `meta.cache`. Con URL configurada y Redis caído, el API usa SQLite y los workers esperan reconexión para conservar exclusión mutua.
4. Definir `TIKTOK_LIVES_ENABLED=true`, `TIKTOK_ADMIN_KEY` con al menos 32 caracteres aleatorios y opcionalmente `TIKTOK_PROXY_URL`. Chrome en Windows: `PUPPETEER_EXECUTABLE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`.
5. Ejecutar `npm run start:dev`, o `npm run build` y `npm run start:prod`. Los cron se ejecutan en el próximo múltiplo de 3 minutos. Los activos se revisan cada 30 segundos. Los trabajos de red vienen deshabilitados hasta configurar explícitamente `TIKTOK_LIVES_ENABLED=true`.

Para ejecutar y comprobar un ciclo sin esperar al cron: `npm run build` seguido de `npm run tiktok:sync`. Este comando verifica tiendas, descubre salas, guarda los resultados reales y muestra el catálogo vigente. Sale con código 1 si no quedan ventas verificadas. Para mantenerlas actualizadas, dejar el backend ejecutándose con `npm run start:dev` o `npm run start:prod`.

El worker también inicia exploración, revisión de tiendas y actualización de salas al arrancar. No bloquea el inicio HTTP mientras espera Chromium. Para el catálogo centrado en Bolivia, configurar `TIKTOK_REQUIRE_REGION=true`: las cuentas sin indicios locales quedan fuera. La bandera 🇧🇴 y el sufijo `.bo`/`_bo` del username son indicios diferenciados, no una ubicación verificada.

La exploración recorre el feed, estilo de vida y chats públicos, expande los creadores recomendados y prioriza vendedores antes de aplicar el límite de salida (por defecto 200, máximo configurable 500). Cada página tiene su propio presupuesto para que gaming no agote la búsqueda. `TIKTOK_SCROLL_STEPS` usa 20 por defecto. La cobertura depende de las recomendaciones y del acceso que TikTok permita; el catálogo no representa un censo de todos los lives del país.

Las salas conocidas se actualizan directamente mediante `webcast/room/info` con su `roomId`, sin repetir las dos consultas de perfil. Si el SDK devuelve un cuerpo vacío, se utiliza la verificación pública del perfil como respaldo; un bloqueo HTTP explícito conserva su backoff. Las conexiones WebSocket se abren en segundo plano: una firma lenta no detiene la verificación HTTP de las otras salas. Durante 60 segundos se consideran recién verificadas; después aparecen como `refreshing` / «Actualizando» hasta un máximo de 300 segundos desde la verificación original. Un fin explícito las retira de inmediato.

## API pública

```http
GET /api/v1/tiktok-lives/active?page=1&limit=20&category=Ropa
```

Categorías: `Ropa`, `Accesorios`, `Electrónica`, `Hogar`, `Belleza`, `Juguetes`, `Otros` (gana la que más términos coincide). Una señal de venta solo en el nombre o la bio de la cuenta no cuenta si el live parece de gaming o música; se ignoran mayúsculas y acentos. Límite máximo: 100. Filtros inválidos: HTTP 400.

Ejemplo ilustrativo del contrato (no corresponde a un live obtenido):

```json
{
  "data": [{
    "username": "mi_tienda",
    "room_id": "7450012345678901234",
    "live_id": "7450012345678901234",
    "title": "Remate de ropa Bolivia",
    "viewer_count": 120,
    "avatar_url": null,
    "cover_image_url": null,
    "tags": ["ropa", "Bolivia"],
    "category": "Ropa",
    "is_selling": true,
    "country_code": "BO",
    "geo_evidence": "keyword:bolivia",
    "source": "discovery",
    "store_id": null,
    "verified_at": "2026-10-26T00:00:00.000Z",
    "live_url": "https://www.tiktok.com/@mi_tienda/live"
  }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "total_pages": 1 },
  "meta": { "cache": "redis", "worker_enabled": true, "freshness_seconds": 60, "country_code": "BO" }
}
```

## Registro de tiendas locales

```http
PUT /api/v1/tiktok-lives/stores/STORE_ID/account
x-tiktok-admin-key: VALOR_PRIVADO_DE_TIKTOK_ADMIN_KEY
Content-Type: application/json

{"tiktok_username":"@mi_tienda"}
```

La asociación se guarda en `TikTokAccount` con unicidad por username y tienda; también actualiza `Store.tiktokUsername`. La clave es administrativa y del servidor: **no incluirla en el frontend público**. El registro declara que la tienda pertenece a `TIKTOK_COUNTRY_CODE`; no acredita titularidad de la cuenta TikTok (`ownership_verified: false`). Los usernames de demostración de `Store` no se importan automáticamente. Para tiendas registradas se utilizan además su categoría y su condición de tienda como señales comerciales.

## Funcionamiento

- **Scraper cada 3 min:** Puppeteer Extra + Stealth, preferencia HTTP `es-BO`, timezone `America/La_Paz`, scroll de documento/paneles, límites de tarjetas y respuestas. Conserva el idioma nativo de `navigator`: forzar `es-BO` allí puede dejar vacío el feed de TikTok. Extrae enlaces `/@usuario/live`, hidratación `SIGI_STATE`/`__UNIVERSAL_DATA_FOR_REHYDRATION__` y JSON observado del sitio. Los selectores y estructuras pueden cambiar.
- **Búsqueda por palabra clave:** además del feed `/live`, cada ciclo abre `https://www.tiktok.com/search/live?q=<término>` para cada término de `TIKTOK_SEARCH_TERMS` (máx. 10), con la misma extracción de enlaces, hidratación y JSON. Si TikTok exige iniciar sesión, se detienen esas búsquedas y se conservan las salas públicas del feed para verificarlas. Un error en una página adicional tampoco descarta las salas ya encontradas.
- **Previsualización:** el parser toma `stream_url.hls_pull_url` / `flv_pull_url` (API) o `streamData.pull_data.stream_data` (HTML), en calidad baja. La API los expone como `stream_hls_url` / `stream_flv_url` (`null` si TikTok no los entrega). Son URLs firmadas y temporales; se renuevan en cada verificación.
- **Rotación de búsquedas:** cada ciclo explora `TIKTOK_SEARCH_TERMS_PER_CYCLE` términos (4 por defecto) de `TIKTOK_SEARCH_TERMS` (máx. 40) y el siguiente ciclo continúa con los siguientes, para cubrir muchos términos sin que un ciclo supere los 3 minutos. `TIKTOK_VERIFY_CONCURRENCY` (5 por defecto, máx. 10) fija cuántas verificaciones HTTP corren a la vez para que más lives se re-verifiquen dentro de los 60 s.
- **Datos derivados del título (API):** `city` (Santa Cruz, La Paz, El Alto, Cochabamba, Sucre, Tarija, Oruro, Potosí, Beni, Pando), `price_text` ("Bs 45", "desde Bs 5", "3 x Bs 140"), `whatsapp_url` (celular boliviano escrito en el título, enlace `wa.me`) y `sales_score` (señal de venta en el título +3, precio +2, WhatsApp +1, categoría conocida +1). La lista se ordena por `sales_score` y luego por espectadores. `GET /active?city=La Paz` filtra por ciudad; `meta.cities` trae el conteo por ciudad de la categoría actual. Son indicios del texto, no datos verificados.
- **Búsqueda sin sesión:** TikTok exige iniciar sesión para `/search/live`; sin sesión el ciclo detecta el aviso, corta ahí y usa solo las fuentes públicas. Por eso `TIKTOK_SEARCH_TERMS` hoy no aporta candidatos.
- **Bola de nieve:** cada ciclo visita la sala de `TIKTOK_SNOWBALL_PER_CYCLE` vendedores en vivo (3 por defecto, en rotación) y recoge los LIVE relacionados que TikTok recomienda ahí, en su mayoría otras tiendas. Se visitan antes de la búsqueda y con 3 pasos de scroll para que el ciclo quepa en 3 minutos.
- **Vendedores conocidos:** cada 3 minutos (desfasado 90 s del descubrimiento) se re-verifican por HTTP `TIKTOK_RECHECK_PER_CYCLE` vendedores terminados (40 por defecto), primero los revisados hace más tiempo, para detectar cuando vuelven a transmitir.
- **Señales de cuenta:** el usuario se analiza con las palabras pegadas (`importadora_ramos_`, `fardospormayorkoreanos`, `jugueteria.gissel`); si indica tienda cuenta como señal de venta de la cuenta (igual que nombre/bio, no aplica a gaming/música) y da la categoría cuando el título no la dice. Bolivia también se reconoce pegada en el usuario (`fardosboliviaofficial`, `mini.kids.scz`) y por un celular boliviano en título, nombre o bio (`phone:bo`; 8 dígitos 6/7, `+591`, `wa.me/591`). Un precio o un celular en el título bastan como señal de venta.
- **Clasificación:** palabras completas con normalización de acentos en el título, nombre, descripción y etiquetas de la cuenta; separa señal comercial de señal regional. “Bolivia” o “SCZ” sin venta no bastan. La región se obtiene de país explícito de TikTok, texto configurado o registro administrativo local. Un país explícitamente distinto se excluye. Con `TIKTOK_REQUIRE_REGION=false` (por defecto) se listan también ventas sin indicio regional, con `geo_evidence: "unverified"`; con `true` solo las que tienen evidencia regional. `geo_evidence` muestra la procedencia; palabras clave son indicios, no GPS verificado.
- **Tiendas cada 3 min:** GET ligero a `/@username/live` mediante la ruta HTML del connector, con respaldo en su ruta pública API-live si el HTML falla o resulta incompleto. Se admite `roomId` en `liveRoom` o en el objeto hermano `user`. Solo estado activo explícito (`2`) y sala válida renuevan verificación. Estado terminado o `roomId=0` retira la sala. Si ambas rutas fallan, se aplica backoff sin anunciar falsamente un fin de transmisión.
- **Activos cada 30s:** nueva comprobación HTTP. Cada lote deja de iniciar consultas a los 20s y prioriza las cuentas menos recientemente revisadas para que las lentas no monopolicen la cola. Las verificaciones iniciadas todavía pueden guardar su resultado. A los 60s una sala pasa de `fresh` a `refreshing`; al cumplir 300s se excluye incluso dentro de una instantánea vigente. Los eventos de viewers y los fallos no renuevan `verified_at`.
- **Sockets:** `tiktok-live-connector` 2.5, límite por proceso (`TIKTOK_MAX_CONNECTIONS=10`), viewers desde `ROOM_USER.total` y retiro ante `streamEnd`. Una desconexión de transporte conserva el live verificado por HTTP y aplica backoff. Fallos del proveedor de firmas mantienen comprobación HTTP con backoff; el excedente del límite también usa HTTP. Los leases no constituyen una cuota global de sockets.
- **Redis:** TTL de la instantánea de 15s, separado de la vigencia de las salas. Invalidación por cambios y versión para impedir que lecturas anteriores resuciten un snapshot invalidado. No se ejecuta FLUSHDB. Leases renovables por trabajo y cuenta para impedir verificaciones simultáneas entre réplicas.
- **Errores:** las cuentas reintentan desde 15s hasta un máximo de 60s más jitter; la exploración conserva su espera de 30s, 60s, 120s… hasta 15min más jitter. CAPTCHA/403/429 cierra Chromium sin resolver el reto. Los fallos no renuevan la vigencia; se omiten trabajos solapados.
- **Directorio web:** `/live` consulta cada 30s y al volver a la pestaña. Un fallo HTTP conserva la última respuesta válida y muestra el aviso de conexión; cada tarjeta vence por su fecha original. Una respuesta válida vacía sí reemplaza la lista. La recuperación opcional de `sessionStorage` conserva el mismo límite de 300s. Las salas pendientes muestran «Actualizando» y no suman espectadores al contador de emisiones recién verificadas. El endpoint web intermedio responde 503 si el backend falla, en vez de simular un catálogo vacío.
- **Cierre:** hooks Nest liberan navegador, agentes y sockets.

`TIKTOK_PROXY_URL` admite proxy HTTP(S) con credenciales para Chromium, HTTP y WebSocket; la selección Bolivia/Latam depende del proveedor. No rota automáticamente IPs para saltar bloqueos. Idioma, timezone y proxy influyen en recomendaciones, pero no garantizan geolocalización del vendedor. Puede haber cero candidatos por personalización, login requerido, bloqueo o cambio de HTML. No se inventan imágenes, métricas ni transmisiones.

`TIKTOK_SIGN_API_KEY` es la clave opcional de Euler Stream para firmas del WebSocket y puede requerir cuenta/cuota propia. No se envían cookies de sesión TikTok autenticada. Metadatos ausentes: `null`, `[]` o `0`.

## Docker, pruebas y alcance

El Dockerfile instala Chromium y usa el usuario `node`, conservando el sandbox (el host debe permitirlo). El compose publica Redis solo en loopback (6380); el backend container usa `redis://tiktok-redis:6379/0`. Pasar variables mediante entorno, nunca secretos en argumentos de build.

```sh
npm run build
npm test -- --testPathPattern=tiktok-lives
```

Las pruebas usan fixtures/mocks: estado activo/offline, payloads del contrato, clasificación, fallos, backoff, eventos, paginación, TTL y autenticación administrativa. No sustituyen una prueba real con una tienda en vivo y Redis/Chromium disponibles. La página `/live` de `marketplace-app` consume este endpoint para la sección de lives detectados automáticamente.

APIs consultadas: [Puppeteer](https://pptr.dev/api/puppeteer.page.emulatetimezone), [Puppeteer Extra/Stealth](https://github.com/berstend/puppeteer-extra), [TikTok LIVE Connector: salas y viewers](https://ttlc.docs.isaackogan.com/guides/room-data/), [conexiones y proveedor de firmas](https://ttlc.docs.isaackogan.com/getting-started/connection/).
