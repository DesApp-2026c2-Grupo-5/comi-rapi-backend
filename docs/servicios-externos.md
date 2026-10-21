# Servicios externos

Comi-Rapi consume tres servicios de terceros. Solo uno necesita una clave, y es gratuita.

| Servicio                                                  | Para qué se usa                                                         | Clave            | Qué pasa si falta                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------- | ----------------------------------------------------- |
| [Georef](https://apis.datos.gob.ar/georef) (datos.gob.ar) | Geocodificar direcciones a coordenadas                                  | No, es pública   | Sin internet, el buscador de direcciones responde 503 |
| [OpenRouteService](https://api.heigit.org/) (HeiGIT)      | Distancia y duración del viaje en auto entre la sucursal y el domicilio | Sí, gratuita     | El cálculo de rutas responde 503                      |
| SMTP                                                      | Correo de recuperación de contraseña                                    | No en desarrollo | El correo no sale, el resto funciona                  |

## Georef: geocodificación de direcciones

API pública de la Argentina, sin registro ni clave. El backend la usa para el autocompletado de calles y localidades y para resolver la dirección de entrega en coordenadas (`POST /api/geo/preview`).

Solo necesita conexión a internet. Si el servicio no responde, la API devuelve 503 con el mensaje "Servicio de geolocalización no disponible temporalmente, intentá de nuevo en unos minutos".

Variables opcionales, con los valores por defecto ya correctos:

```
GEOREF_BASE_URL=https://apis.datos.gob.ar/georef
GEOREF_TIMEOUT_MS=5000
GEOREF_MAX_RESULTADOS=10
```

## OpenRouteService: distancia y duración del viaje

El cálculo de rutas alimenta tres cosas: la cobertura (elegir la sucursal más cercana), el tiempo estimado de entrega (tiempo de cocina más tiempo de viaje) y el caché de distancias de la tabla `DistanciasRutas`.

### Cómo obtener la clave

1. Crear una cuenta en [account.heigit.org/signup](https://account.heigit.org/signup).
2. Entrar al panel y copiar la API key (token personal).
3. El plan Standard es gratuito y alcanza para el proyecto: 2000 consultas de Directions por día y 40 por minuto.

### Dónde se carga

En un archivo `.env.local` en la raíz de `comi-rapi-backend`. Ese archivo no se versiona y tiene prioridad sobre `.env.development`, así que es el lugar indicado para las claves:

```
ORS_API_KEY=tu-clave-de-heigit
```

Después hay que reiniciar el backend, porque la clave se lee al levantar el proceso.

La URL que usa el backend es `https://api.heigit.org/openrouteservice`. La anterior, `api.openrouteservice.org`, quedó deprecada y se apaga entre el 2 y el 6 de noviembre de 2026.

### Sin clave

El backend responde 503 con el mensaje "Servicio de rutas no disponible temporalmente, intentá de nuevo en unos minutos", y en la consola del servidor queda registrado el motivo:

```
CredencialesInvalidasError: ORS_API_KEY no está configurada. Configurá tu clave de OpenRouteService en el archivo .env.local
```

Lo único que funciona sin clave son los pares de coordenadas que ya estén en la tabla `DistanciasRutas`, porque el cálculo se sirve del caché y no se vuelve a llamar al proveedor.

El caché se llena solo: la primera vez que se calcula una distancia con una clave válida, el resultado queda guardado y los pedidos siguientes a esa misma dirección no vuelven a consumir cuota. Ojo con esto, porque los seeders no cargan el caché: en una base recién sembrada está vacío, así que la clave hace falta desde el primer pedido.

### Proveedor alternativo

Geoapify ([geoapify.com](https://geoapify.com)) implementa el mismo contrato de routing y se activa por variable de entorno:

```
ROUTING_PROVIDER=geoapify
GEOAPIFY_API_KEY=tu-clave
```

## SMTP: correo de recuperación de contraseña

En desarrollo el correo no sale a internet: Docker levanta Mailpit junto a PostgreSQL.

- SMTP en `localhost:1025`.
- Interfaz web en `http://localhost:8025`, donde se lee el correo recibido.

Mailpit acepta cualquier usuario y contraseña, por eso `SMTP_USER` y `SMTP_PASSWORD` van vacíos. La configuración ya viene en `.env.development`:

```
MAIL_TRANSPORT=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=no-reply@comiapi.local
```

Para probarlo: en la pantalla de login, elegir "Olvidé mi contraseña" e introducir un correo de prueba. El correo aparece en la interfaz de Mailpit con el enlace para elegir la nueva contraseña.

Si no hay SMTP configurado (`MAIL_TRANSPORT` vacío o distinto de `smtp`), la respuesta al usuario es la misma de siempre ("Si existe una cuenta asociada al email, recibirás un enlace para recuperar tu contraseña") pero no se envía nada. El backend lo avisa en la consola:

```
[recuperacion] email no enviado a cliente@test.com (sin-transporte)
```

El token no se escribe en el log en ese caso, para no filtrar el enlace de recuperación.

En producción se cambia solo la configuración por las variables de un proveedor real (Brevo, SendGrid, Mailgun, SES), sin tocar código. Con TLS implícito (puerto 465) hay que poner `SMTP_SECURE=true`; con STARTTLS (puerto 587), `SMTP_REQUIRE_TLS=true`.

`FRONTEND_URL` tiene que apuntar a la URL pública del frontend, porque el enlace del correo se arma con esa variable.

## Otras variables

- `SESSION_SECRET`: firma las cookies de sesión. El valor de `.env.development` sirve para desarrollo; en producción hay que cambiarlo desde `.env.local`.
- `CORS_ORIGIN`: origen del frontend permitido por el backend. Por defecto `http://localhost:5173`.
- `IMAGENES_DIR`: carpeta donde el backend guarda las imágenes subidas. Por defecto `../comi-rapi-fronted/public/imagenes/productos`, por eso los dos repositorios tienen que quedar en carpetas hermanas.
- En el frontend, `VITE_API_URL` y `VITE_SOCKET_URL` (archivo `.env`) sirven para apuntar a un backend remoto en lugar de `localhost:3000`.

## Qué hace falta para cada cosa

- **Login, catálogo, carrito, panel de administración y superadministrador**: no hace falta ninguna clave.
- **Hacer un pedido**: hace falta internet (Georef) y la clave de OpenRouteService. El caché de distancias arranca vacío en una base recién sembrada, así que la clave se necesita desde el primer pedido, no solo para direcciones nuevas.
- **Mostrar el correo de recuperación**: hace falta Mailpit, que ya levanta `docker compose up -d`.
- **Repartir la clave entre los integrantes**: la clave de HeiGIT es personal y el archivo `.env.local` no se versiona, así que cada uno tiene que sacar la suya en [account.heigit.org](https://account.heigit.org/signup) o usar la del que la tenga a mano.
