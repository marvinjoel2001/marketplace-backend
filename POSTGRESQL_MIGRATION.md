# PostgreSQL del marketplace

El backend usa PostgreSQL con Prisma 5.22. El esquema de producción es `prisma/schema.prisma`; las migraciones revisables están en `prisma/migrations/`. Node requiere al menos 22.16 por la herramienta de respaldo de la base anterior.

## Arranque

`npm run start:prod` y el Dockerfile ejecutan `scripts/start-production.cjs`:

1. Exige una `DATABASE_URL` PostgreSQL.
2. Ejecuta `prisma migrate deploy` sin opciones de pérdida de datos.
3. Solo si existe `SQLITE_MIGRATION_PATH`, importa el archivo anterior con `migrate-sqlite-to-postgres.cjs`.
4. Prepara categorías y arranca el API.

La importación hace un respaldo consistente con SQLite Backup API en `backups/`, conserva el archivo original y copia todas las tablas dentro de una transacción PostgreSQL. Rechaza destinos con datos, verifica cantidades y guarda el marcador `database.sqlite-to-postgresql.v1` en `AppSetting`. Los reinicios posteriores no repiten la copia. Una importación fallida revierte todas sus escrituras y no inicia el API.

Los IDs, fechas UTC, valores nulos, booleanos, cantidades, hashes de contraseña, configuración e inventario se conservan. No se publican datos ni credenciales en los logs.

## Railway

Proyecto: `9fcca833-0203-4509-8115-ab587c9e73a2`, entorno production.

- PostgreSQL: servicio `a095be19-e157-4926-9280-f92bc694a266` (Postgres).
- API: servicio `f0edf1c5-a392-42f6-90fb-b4876ca75ea8` (marketplace-backend).
- `DATABASE_URL` del API referencia `${{Postgres.DATABASE_URL}}`; no pegar ni versionar la contraseña.
- `UPLOAD_DIR=/data/uploads` conserva las fotos en el volumen del API.
- `SQLITE_MIGRATION_PATH=/data/marketplace.db` es únicamente el origen de la importación inicial; el API usa PostgreSQL.
- La base PostgreSQL se mantiene en la red privada. Para administrar desde la máquina local se puede usar un túnel SSH, sin habilitar un proxy TCP público.

No restaurar la base anterior después de recibir escrituras en PostgreSQL: se perderían esos cambios nuevos. El respaldo anterior sirve para recuperar el estado previo al corte; la recuperación posterior debe partir de PostgreSQL.

## Desarrollo y pruebas

`docker compose -f docker-compose.marketplace.yml up -d --build` incluye PostgreSQL en `127.0.0.1:5433`, base `marketplace_db`. Los datos y las fotos tienen volúmenes propios. Las credenciales de los compose son exclusivamente de desarrollo.

Comprobaciones realizadas el 2 de noviembre de 2026:

- Build del backend correcto y 39 suites / 327 pruebas aprobadas.
- `MIGRATION_TEST_DATABASE_URL=... npm run test:postgres-migration`: destino no vacío, reversión integral por fallo, tipos, relaciones, respaldo e importación única. Solo crea un esquema de prueba con nombre aleatorio y lo elimina al terminar.
- Ensayo con un respaldo consistente de producción: 358 filas; comparación de todos los campos e IDs con la copia en PostgreSQL. El esquema temporal se eliminó al terminar.
- Los fixtures SQLite de la suite TikTok generan su cliente aislado; no cambian el proveedor de producción ni usan las bases del usuario.

Estado del cambio productivo y evidencias: `../artifacts/postgres-migration/` y registro en `../AGENT_COORDINATION.md`.
