# Repositorio base: API NodeJS

## Configuración inicial

```shell
# Levantar y configurar la base de datos
docker-compose up -d

# Copiar las variables de entorno necesarias para acceder a la DB
cp .env.example .env
```

## Base de datos

```shell
# Ejecutar las migraciones
npx sequelize db:migrate

# Cargar datos de prueba
npx sequelize db:seed:all

# Crear una nueva migración
npx sequelize migration:generate --name add-descripcion-to-producto

# Crear un nuevo seed
npx sequelize seed:generate --name edificios
```

## Proyecto

```shell
# Levantar el proyecto, queda monitoreando los cambios
npm start

# Ejecutar los tests
npm test
```
