# TikTok LIVE para Vitrina Market

El módulo `src/modules/tiktok-lives/` está registrado en `AppModule`. El endpoint público consulta Redis o SQLite; nunca ejecuta scraping dentro de una petición del frontend. Los lives de demostración existentes en `LiveStream` no se convierten en transmisiones reales.

## Configuración y ejecución

Requisitos: Node.js 22.12+, Chrome/Chromium y Redis para varias instancias (Puppeteer 25 requiere Node 22.12+).

1. Instalar dependencias con `npm ci`. Para usar Chrome ya instalado, configurar `PUPPETEER_EXECUTABLE_PATH` y usar `PUPPETEER_SKIP_DOWNLOAD=true` al instalar. Alternativamente: `npx puppeteer browsers install chrome`.
2. Respaldar SQLite, ejecutar `npm run prisma:generate` y aplicar las tablas nuevas mediante `npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/tiktok-lives.sql`. El SQL es aditivo. Para una base nueva, usar el flujo existente `npm run prisma:push`.
3. Copiar las variables `TIKTOK_*` de `.env.example` a `.env`. Configurar `TIKTOK_REDIS_URL` (p. ej. `redis://127.0.0.1:6380/0` para Redis del compose). Sin URL se utiliza memoria para **una instancia**, indicada en `meta.cache`. Con URL configurada y Redis caído, el API usa SQLite y los workers esperan reconexión para conservar exclusión mutua.
4. Definir `TIKTOK_LIVES_ENABLED=true`, `TIKTOK_ADMIN_KEY` con al menos 32 caracteres aleatorios y opcionalmente `TIKTOK_PROXY_URL`. Chrome en Windows: `PUPPETEER_EXECUTABLE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`.
5. Ejecutar `npm run start:dev`, o `npm run build` y `npm run start:prod`. Los cron se ejecutan en el próximo múltiplo de 3 minutos. Los activos se revisan cada 30 segundos. Los trabajos de red vienen deshabilitados hasta configurar explícitamente `TIKTOK_LIVES_ENABLED=true`.

## API pública

```http
GET /api/v1/tiktok-lives/active?page=1&limit=20&category=Ropa
```

Categorías: `Ropa`, `Electrónica`, `Hogar`, `Belleza`, `Otros`; se ignoran mayúsculas y acentos. Límite máximo: 100. Filtros inválidos: HTTP 400.

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

- **Scraper cada 3 min:** Puppeteer Extra + Stealth, idioma `es-BO`, timezone `America/La_Paz`, scroll de documento/paneles, límites de tarjetas y respuestas. Extrae enlaces `/@usuario/live`, hidratación `SIGI_STATE`/`__UNIVERSAL_DATA_FOR_REHYDRATION__` y JSON observado del sitio. Los selectores y estructuras pueden cambiar.
- **Clasificación:** palabras completas con normalización de acentos; separa señal comercial de señal regional. “Bolivia” o “SCZ” sin venta no bastan. La región se obtiene de país explícito de TikTok, texto configurado o registro administrativo local. Un país explícitamente distinto se excluye. `geo_evidence` muestra la procedencia; palabras clave son indicios, no GPS verificado.
- **Tiendas cada 3 min:** GET ligero a `/@username/live` mediante la ruta HTML del connector. Solo estado activo explícito (`2`) y sala válida renuevan verificación. Estado terminado o `roomId=0` retira la sala. Respuestas desconocidas y CAPTCHA provocan backoff, sin anunciar falsamente un fin de transmisión.
- **Activos cada 30s:** nueva comprobación HTTP. La API excluye verificaciones con más de 60 segundos incluso dentro de una instantánea Redis vigente. Los eventos de viewers no renuevan ese plazo.
- **Sockets:** `tiktok-live-connector` 2.5, límite por proceso (`TIKTOK_MAX_CONNECTIONS=10`), viewers desde `ROOM_USER.total` y retiro ante `streamEnd`/desconexión. Fallos del proveedor de firmas mantienen comprobación HTTP con backoff; el excedente del límite también usa HTTP. Los leases no constituyen una cuota global de sockets.
- **Redis:** TTL 60s, invalidación por cambios, versión para impedir que lecturas anteriores resuciten un snapshot invalidado. No se ejecuta FLUSHDB. Leases renovables por trabajo y cuenta para impedir verificaciones simultáneas entre réplicas.
- **Errores:** espera de 30s, 60s, 120s… hasta 15min más jitter, respetada en ciclos siguientes. CAPTCHA/403/429 cierra Chromium sin resolver el reto. Los fallos no renuevan la vigencia. Tres verificaciones concurrentes por trabajo; los lotes grandes pueden superar el intervalo y se omiten solapamientos.
- **Cierre:** hooks Nest liberan navegador, agentes y sockets.

`TIKTOK_PROXY_URL` admite proxy HTTP(S) con credenciales para Chromium, HTTP y WebSocket; la selección Bolivia/Latam depende del proveedor. No rota automáticamente IPs para saltar bloqueos. Idioma, timezone y proxy influyen en recomendaciones, pero no garantizan geolocalización del vendedor. Puede haber cero candidatos por personalización, login requerido, bloqueo o cambio de HTML. No se inventan imágenes, métricas ni transmisiones.

`TIKTOK_SIGN_API_KEY` es la clave opcional de Euler Stream para firmas del WebSocket y puede requerir cuenta/cuota propia. No se envían cookies de sesión TikTok autenticada. Metadatos ausentes: `null`, `[]` o `0`.

## Docker, pruebas y alcance

El Dockerfile instala Chromium y usa el usuario `node`, conservando el sandbox (el host debe permitirlo). El compose publica Redis solo en loopback (6380); el backend container usa `redis://tiktok-redis:6379/0`. Pasar variables mediante entorno, nunca secretos en argumentos de build.

```sh
npm run build
npm test -- --testPathPattern=tiktok-lives
```

Las pruebas usan fixtures/mocks: estado activo/offline, payloads del contrato, clasificación, fallos, backoff, eventos, paginación, TTL y autenticación administrativa. No sustituyen una prueba real con una tienda en vivo y Redis/Chromium disponibles. El frontend aún debe consumir este endpoint en lugar de los lives de demostración.

APIs consultadas: [Puppeteer](https://pptr.dev/api/puppeteer.page.emulatetimezone), [Puppeteer Extra/Stealth](https://github.com/berstend/puppeteer-extra), [TikTok LIVE Connector: salas y viewers](https://ttlc.docs.isaackogan.com/guides/room-data/), [conexiones y proveedor de firmas](https://ttlc.docs.isaackogan.com/getting-started/connection/).
