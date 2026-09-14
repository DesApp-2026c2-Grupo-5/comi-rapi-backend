# Reset de base de datos local — Comi-Rapi

Guía práctica para resetear por completo las bases de datos locales de desarrollo y test. El reset es **local**: afecta solo el entorno Docker de cada integrante y no toca producción ni el repositorio.

## Cuándo hace falta un reset completo

- Cuando una migración agrega una columna `NOT NULL` **sin default** y la tabla ya tiene filas, la migración falla (`column ... contains null values`).
- Cuando se modifican migraciones aún no desplegadas de forma incompatible con las ya aplicadas.
- Cuando el esquema local quedó en un estado inconsistente y es más simple re-crearlo que corregirlo.

En general: ante cualquier migración que no pueda correr sobre datos existentes, o cuando se quiere partir de un estado limpio.

## Requisitos

- Docker Desktop corriendo.
- Node 14 (ver `.nvmrc` / `engines` de `package.json`).

## Secuencia exacta

```bash
# 1. Bajar el contenedor y borrar el volumen de datos (postgres_data)
docker compose down -v

# 2. Levantar de nuevo (Postgres se inicializa con datos vacíos)
docker compose up -d

# 3. Esperar a que PostgreSQL esté listo
#    (el healthcheck usa pg_isready; aguardar unos segundos o que quede "healthy")
docker compose ps

# 4. Migrar la base de desarrollo
npm run db:init

# 5. Migrar la base de test
$env:NODE_ENV = "test"
npm run db:migrate

# 6. Cargar los seeders (development)
$env:NODE_ENV = "development"
npm run db:seed
```

> En PowerShell no usar `&&`; encadenar con `;` o ejecutar en pasos separados.

## Nota sobre el volumen de datos

El `docker-compose.yml` usa un **volumen Docker nombrado** (`postgres_data`), no un bind mount. Esto hace que `docker compose down -v` efectivamente borre los datos de Postgres. No usar `./docker/postgres/data` como bind mount (ya no se usa).

## Fallback manual (creación de bases + grants)

El contenedor crea por defecto la base `unahur_desapp_dev` (vía `POSTGRES_DB`). La base `unahur_desapp_test` se crea mediante `docker/postgres/init/crear-db.sh`, que corre solo la primera vez que el volumen está vacío.

Si al levantar el contenedor `unahur_desapp_test` no existe, crearla manualmente:

```bash
docker exec -it comi-rapi-backend-db-1 psql -U unahur_desapp -d postgres -c "CREATE DATABASE unahur_desapp_test;"
docker exec -it comi-rapi-backend-db-1 psql -U unahur_desapp -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE unahur_desapp_test TO unahur_desapp;"
docker exec -it comi-rapi-backend-db-1 psql -U unahur_desapp -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE unahur_desapp_dev TO unahur_desapp;"
```

## Cada integrante debe ejecutar el reset en su máquina

Este procedimiento es **por entorno local**. No se resuelve una sola vez para todos: cada desarrollador debe correr `docker compose down -v` + `docker compose up -d` (y las migraciones/seeders) en su propia máquina cuando sea necesario.
