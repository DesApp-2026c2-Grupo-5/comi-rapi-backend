# Estructura del backend — Comi-Rapi

## 1. Propósito

Este documento define la organización de carpetas y archivos acordada para el backend de **Comi-Rapi**. Sirve como referencia para las tareas posteriores de implementación: las capas se completan de forma progresiva, sin necesidad de crear todos los archivos desde el inicio.

## 2. Principio arquitectónico

El backend sigue una arquitectura por capas con el siguiente flujo:

```
Routes → Middlewares → Controllers → Services → Models → Database
```

Responsabilidad de cada capa:

- **Routes**: declaran endpoints (método + ruta + middlewares + controller). Sin lógica de negocio.
- **Middlewares**: autenticación/autorización, manejo de errores y validación de entrada.
- **Controllers**: traducen HTTP↔dominio; orquestan la petición. No contienen reglas de negocio.
- **Services**: contienen las reglas de negocio (asignación de sucursal, transiciones de estado, stock, promociones).
- **Models**: modelos Sequelize, una entidad del DER por archivo.
- **Database**: PostgreSQL, accedida a través de los modelos.

## 3. Árbol de estructura definitiva

```
comi-rapi-backend/
├── bin/
│   └── www.js                 # punto de entrada del servidor
├── lib/
│   ├── app.js                 # montaje de Express (middlewares globales + rutas)
│   ├── config/
│   │   ├── config.js          # carga de entorno + configuración general
│   │   └── config-sequelize.js# puente para sequelize-cli
│   ├── routes/                # endpoints por recurso
│   │   ├── index.js
│   │   └── utils.js           # withErrorHandling / errorAwareRouter
│   ├── middlewares/
│   │   └── error_handler.js   # manejo centralizado de errores
│   ├── controllers/           # handlers HTTP por recurso
│   ├── services/              # reglas de negocio
│   ├── models/                # modelos Sequelize (una entidad por archivo)
│   │   └── index.js           # auto-descubrimiento + init/associate
│   └── utils/                 # helpers transversales (aún sin crear)
├── db/
│   ├── migrations/            # esquema de BD versionado
│   └── seeders/               # datos de arranque/referencia
├── test/
│   └── db_utils.js            # helpers compartidos de prueba
└── docs/                      # documentación (separada del código)
```

## 4. Responsabilidad de las carpetas principales

- **`bin/`** — Punto de entrada: crea el servidor HTTP, realiza el `authenticate` de Sequelize y lanza `listen`.
- **`lib/config/`** — Carga las variables de entorno (`.env.*`), normaliza el puerto y construye la configuración de Sequelize; además provee el puente para `sequelize-cli`.
- **`lib/routes/`** — Declaran los endpoints (método + ruta + middlewares + controller). No contienen lógica de negocio.
- **`lib/middlewares/`** — Autenticación/autorización, manejo de errores y (a futuro) validación de entrada.
- **`lib/controllers/`** — Traducen HTTP↔dominio y orquestan la petición. No contienen reglas de negocio.
- **`lib/services/`** — Reglas de negocio reutilizables.
- **`lib/models/`** — Modelos Sequelize correspondientes a las entidades del DER.
- **`lib/utils/`** — Helpers transversales sin estado. Carpeta prevista, aún sin crear; solo se materializará cuando una implementación concreta la requiera.
- **`db/migrations/`** — Migraciones de base de datos gestionadas por Sequelize.
- **`db/seeders/`** — Datos iniciales/de referencia.
- **`test/`** — Helpers compartidos de prueba. Las pruebas unitarias se colocan junto al código como `*.test.js`.
- **`docs/`** — Documentación del proyecto, separada del código.

## 5. Convenciones relevantes

- Un archivo por entidad en `models/` (sin agrupar varias entidades en un solo archivo).
- Nombres de archivos de entidades en `snake_case`.
- Tablas de base de datos en plural (según el DER).
- Arquitectura por capas (routes → middlewares → controllers → services → models).
- Las reglas de negocio viven en `services/`.
- Los `controllers` no contienen reglas de negocio.
- Las `routes` no contienen reglas de negocio.
- La documentación se mantiene separada en `docs/`.

## 6. Estado de implementación

**Ya existente (conservar y reutilizar):**

- Estructura general de carpetas (`bin/`, `lib/` con sus capas, `db/`, `test/`, `docs/`).
- Infraestructura de arranque y configuración (`bin/www.js`, `lib/app.js`, `lib/config/`).
- Auto-descubrimiento de modelos (`lib/models/index.js`).
- Manejo centralizado de errores (`lib/middlewares/error_handler.js`).
- CRUD funcional de `Categoria` y `Producto` (modelo, migración, controller, ruta y seeder).
- Helper de rutas (`lib/routes/utils.js`).

**Se implementará posteriormente (a medida que avance el desarrollo):**

- Modelos restantes del DER, migraciones, controllers, servicios y rutas de las entidades aún no implementadas.
- Reglas de negocio en `services/` (asignación de sucursal, transiciones de estado, stock, promociones, reportes).
- Carpeta `lib/utils/` y sus helpers, solo cuando una implementación concreta los necesite.

No se crean placeholders únicamente para completar la estructura: cada archivo debe responder a una necesidad real de implementación.

## 7. Evolución prevista

Las carpetas `models/`, `controllers/`, `services/`, `routes/`, `middlewares/` y `utils/` se completarán progresivamente conforme se implementen las funcionalidades del sistema. La estructura está preparada para crecer, sin requerir que todos los archivos existan desde el inicio.