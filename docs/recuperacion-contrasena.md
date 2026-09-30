# Contexto: Recuperación de contraseña

Documento de traspaso para el equipo. Resume cómo funciona la función, qué archivos tocar y cómo ejecutarla.

---

## 1. Qué hace

Permite que un usuario que olvidó su contraseña reciba un email con un enlace, lo abra, elija una contraseña nueva y vuelva a entrar sin pedirle nada al administrador.

El flujo tiene cuatro etapas: **pedir el enlace → recibir el email → usar el token → iniciar sesión con la contraseña nueva.**

La regla que gobierna todo el diseño es que **el backend nunca revela si un email está registrado**. Un atacante podría usar la función para averiguar cuáles son los clientes de la aplicación, así que todas las respuestas son genéricas.

---

## 2. Cómo se pide el enlace

`POST /api/auth/forgot-password` con `{ "email": "..." }`.

El backend normaliza el email (recorta espacios y pasa a minúsculas), busca un usuario activo y, si lo encuentra:

1. Invalida los tokens que ese usuario ya tenía pendientes, sin borrarlos (quedan para auditoría).
2. Genera un token nuevo de 64 caracteres hexadecimales.
3. Guarda **solo el hash SHA-256** del token. El texto plano existe únicamente en memoria, el tiempo de armar el email.
4. Envía el email con el enlace.

Si el email no existe, no se genera nada y se responde **exactamente lo mismo**. La respuesta es siempre:

> Si existe una cuenta asociada al email, recibirás un enlace para recuperar tu contraseña.

La función tampoco emite tokens para cuentas inactivas.

## 3. Cómo se usa el enlace

El email lleva un enlace de la forma `{FRONTEND_URL}/reset-password?token=...`.

`POST /api/auth/reset-password` con `{ token, password, confirmPassword }`.

Primero se valida la contraseña (que coincida y tenga 6 caracteres o más) **sin tocar la base**, para no gastar el token si el usuario se equivocó al escribirla. Después se aplica el cambio.

## 4. Qué pasa al cambiar la contraseña

Todo ocurre dentro de **una sola transacción**, y en este orden:

1. Se toma el token con `SELECT ... FOR UPDATE`, que bloquea la fila.
2. Se re-evalúa el estado del token.
3. Se bloquea el usuario y se actualiza su password. El hash Argon2id lo aplica el hook del modelo, por eso se actualiza la instancia y no con un update masivo.
4. Se marca el token como usado (`usedAt`).
5. Se borran todas las sesiones abiertas del usuario.

Si algo falla en cualquier punto, PostgreSQL hace rollback y no queda ni la contraseña cambiada, ni el token consumido, ni las sesiones borradas.

**El paso 1 es una decisión de seguridad, no una optimización.** El token se valida dos veces: una antes de abrir la transacción (para no abrirla si el token ya se sabe descartado) y otra adentro, con la fila ya bloqueada. Sin ese bloqueo, dos peticiones simultáneas con el mismo token válido podrían pasar la validación inicial y las dos cambiarían la contraseña.

Como las sesiones se borran, **el usuario queda desconectado de todos sus dispositivos** al recuperar la contraseña. Es lo esperado.

---

## 5. Estados del token

El servicio clasifica cada token internamente. Ese estado **solo se usa en los logs del servidor y en los tests**: la respuesta pública es siempre la misma.

| Estado        | Qué significa                               | Qué ve el usuario |
| ------------- | ------------------------------------------- | ----------------- |
| `vigente`     | Emitido, dentro de los 10 minutos, sin usar | —                 |
| `inexistente` | El hash no coincide con nada registrado     | Mensaje genérico  |
| `invalido`    | No tiene el formato esperado (64 hex)       | Mensaje genérico  |
| `expirado`    | Pasaron los 10 minutos                      | Mensaje genérico  |
| `usado`       | Ya se usó en un cambio anterior             | Mensaje genérico  |
| `invalidado`  | Se pidió otro enlace y este quedó atrás     | Mensaje genérico  |

El mensaje para todos los casos es _"El enlace de recuperación no es válido o ya expiró."_

**Consecuencia para el frontend:** no se puede distinguir "expirado" de "ya usado". No es una limitación de la implementación, es intencional: cualquier diferenciación le serviría a un atacante para sondear tokens. La interfaz muestra un solo mensaje.

### Tabla `PasswordResetTokens`

| Columna                   | Tipo    | Notas                                   |
| ------------------------- | ------- | --------------------------------------- |
| `id`                      | INTEGER | PK                                      |
| `usuarioId`               | INTEGER | FK a `Usuario.id`, ON DELETE CASCADE    |
| `tokenHash`               | STRING  | UNIQUE, SHA-256 en hexadecimal (64)     |
| `expiresAt`               | DATE    |                                         |
| `usedAt`                  | DATE    | NULL, se setea al consumir el token     |
| `invalidatedAt`           | DATE    | NULL, se setea al pedir un enlace nuevo |
| `createdAt` / `updatedAt` | DATE    |                                         |

Índices en `usuarioId`, `expiresAt`, `usedAt` e `invalidatedAt`.

### API interna del servicio

`password_reset_service.js` exporta: `normalizarEmail()`, `generarToken()`, `hashearToken()`, `esTokenBienFormado()`, `calcularExpiracion()`, `emitirTokenRecuperacion()`, `clasificarToken()`, `clasificarRegistro()`, `eliminarSesiones()`, `aplicarCambioDePassword()` y la clase `TokenNoUtilizableError`.

`clasificarRegistro()` existe separada de `clasificarToken()` a propósito: es la que permite re-evaluar el estado **dentro** de la transacción, sobre la fila ya bloqueada, sin volver a consultar la base.

---

## 6. Archivos

### Backend

| Archivo                                                       | Responsabilidad                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `db/migrations/20260929000001-create-password-reset-token.js` | Crea la tabla                                                         |
| `lib/models/password_reset_token.js`                          | Modelo y relación con `Usuario`                                       |
| `lib/services/password_reset_service.js`                      | Toda la lógica: generación, hash, emisión, clasificación, transacción |
| `lib/services/email_service.js`                               | Envío por SMTP con Nodemailer                                         |
| `lib/controllers/password_reset_controller.js`                | Traduce HTTP ↔ dominio                                                |
| `lib/middlewares/rate_limit.js`                               | Limitadores por IP y por email                                        |
| `lib/routes/auth.js`                                          | Registra los dos endpoints                                            |
| `scripts/limpiar-tokens-expirados.js`                         | Mantenimiento de la tabla                                             |
| `test/transacciones_utils.js`                                 | Helper para probar el rollback                                        |

### Frontend

| Archivo                                   | Responsabilidad                                       |
| ----------------------------------------- | ----------------------------------------------------- |
| `src/pages/comunes/RecuperarPassword.jsx` | Pantalla para pedir el enlace                         |
| `src/pages/comunes/NuevaPassword.jsx`     | Pantalla para elegir la contraseña nueva              |
| `src/api/auth.js`                         | `solicitarRecuperacion()` y `restablecerPassword()`   |
| `src/routes/AppRoutes.jsx`                | Rutas públicas `/forgot-password` y `/reset-password` |
| `src/pages/comunes/Login.jsx`             | Link "¿Olvidaste tu contraseña?"                      |

---

## 7. Seguridad

- El token se genera con `crypto.randomBytes(32)`. No se usa `randomUUID()` porque el proyecto declara Node 14.15.
- En la base solo hay SHA-256. Ni el token, ni su password nueva, ni el enlace completo se escriben en los logs.
- Un token es de un solo uso y vive 10 minutos.
- Pedir un enlace nuevo invalida los anteriores del mismo usuario.
- **Rate limiting doble**: 3 solicitudes por hora, contadas por IP y por email normalizado. Se aplican los dos aunque el email no exista, así el endpoint se comporta igual en todos los casos.
- Las contraseñas se hashean con Argon2id, igual que el resto del proyecto.
- Los tokens no se borran al consumirse ni al invalidarse; quedan como historial auditable. La limpieza es un script aparte.

---

## 8. Configuración

En `.env.development`, `.env.test` y `.env.example`:

| Variable                                         | Por defecto              | Para qué                                  |
| ------------------------------------------------ | ------------------------ | ----------------------------------------- |
| `FRONTEND_URL`                                   | `http://localhost:5173`  | Base del enlace que se manda por email    |
| `PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES`        | `10`                     | Vigencia del token                        |
| `PASSWORD_RESET_RATE_LIMIT_IP_MAX`               | `3`                      | Límite por IP                             |
| `PASSWORD_RESET_RATE_LIMIT_IP_WINDOW_MINUTES`    | `60`                     | Ventana del límite por IP                 |
| `PASSWORD_RESET_RATE_LIMIT_EMAIL_MAX`            | `3`                      | Límite por email                          |
| `PASSWORD_RESET_RATE_LIMIT_EMAIL_WINDOW_MINUTES` | `60`                     | Ventana del límite por email              |
| `MAIL_TRANSPORT`                                 | vacío                    | Con `smtp` se envía; vacío, no            |
| `SMTP_HOST`                                      | `localhost`              | `mailpit` si el backend corre en Docker   |
| `SMTP_PORT`                                      | `1025`                   | Puerto de Mailpit                         |
| `SMTP_FROM`                                      | `no-reply@comiapi.local` | Remitente                                 |
| `SMTP_SECURE`                                    | `false`                  | `true` para TLS implícito (puerto 465)    |
| `SMTP_REQUIRE_TLS`                               | `false`                  | `true` para obligar STARTTLS (puerto 587) |
| `SMTP_REJECT_UNAUTHORIZED`                       | `true`                   | Validar el certificado del servidor       |

`SMTP_SECURE` y `SMTP_REQUIRE_TLS` existen para que cambiar a un proveedor real (SendGrid, SES, Brevo, Mailgun) sea solo cuestión de variables, sin tocar código.

---

## 9. Pruebas

**215 tests pasan, 61 de ellos nuevos.**

| Suite                               | Tests | Qué cubre                                                                                                                             |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `password_reset_service.test.js`    | 28    | Hash, expiración exacta de 10 minutos, invalidación de pendientes, los seis estados, rollback real, concurrencia                      |
| `email_service.test.js`             | 10    | Armado del enlace, que no se filtre el token, conversación SMTP real y contenido del mensaje, destinatario y remitente, fallo de SMTP |
| `rate_limit.test.js`                | 7     | Límite por IP, por email normalizado, mensaje 429 genérico, desactivación por config                                                  |
| `password_reset_controller.test.js` | 16    | Respuestas idénticas para email existente e inexistente, token inválido indistinguible, reuso rechazado                               |

Tres detalles que conviene conocer antes de tocar esas pruebas:

- El test de rollback instala un trigger temporal que hace fallar el borrado de sesiones, que es el último paso de la transacción. Se comprobó que verificarlo bloqueando la tabla genera un deadlock con el pool de conexiones, así que ese enfoque quedó descartado a propósito.
- El test de concurrencia lanza dos cambios de contraseña en paralelo y exige que **exactamente uno** gane. Es la regresión que protege el bloqueo de fila; si ese test falla, se rompió la protección contra la condición de carrera.
- **Los tests de email no usan Mailpit.** Levantan un servidor SMTP mínimo en memoria, en un puerto efímero de localhost, y capturan el mensaje ahí. Así se sigue verificando la conversación SMTP y el contenido (incluido el token en claro) sin dejar correos de prueba en la bandeja del desarrollador. El mensaje llega codificado en quoted-printable por los acentos, por eso el test lo decodifica antes de buscar el token.
- **En tests el hash de Argon2 usa un costo bajo a propósito.** El modelo encripta con `config.argon2`: en producción y desarrollo están los parámetros estándar (`timeCost=3`, 64 MiB), pero en `NODE_ENV=test` bajan a (`timeCost=2`, 1 MiB, paralelismo 1). El algoritmo y el formato del hash son idénticos — solo cambia el esfuerzo de cálculo — así que `verify()` no distingue. Cualquier hash con parámetros bajos que aparezca en la base de test es esto, no un error. Si alguna vez un test de producción assertionara costos altos (no lo hacen), se ajusta con `ARGON2_TIMECOST`/`ARGON2_MEMORYCOST`/`ARGON2_PARALLELISM`.

---

## 10. Cómo ejecutarlo

### Requisitos

Node 14.15 o superior, Docker y npm.

### Paso a paso

**1. Levantar la base de datos y Mailpit**

Desde `comi-rapi-backend`:

```bash
docker compose up -d db mailpit
```

Mailpit queda con su interfaz web en <http://localhost:8025>, que es donde se ven los emails.

**2. Instalar dependencias del backend y aplicar la migración**

```bash
npm install
npm run db:migrate
```

**3. Revisar la configuración**

Abrir `.env.development` y confirmar que `MAIL_TRANSPORT=smtp` y `SMTP_HOST=localhost`. Con esos valores el backend local manda los emails a Mailpit. Si no hay transporte configurado, la función **no envía nada** y solo responde el mensaje genérico.

**4. Levantar el backend**

```bash
npm run dev
```

Queda en `http://localhost:3000`.

**5. Levantar el frontend**

En otra terminal, desde `comi-rapi-fronted`:

```bash
npm install
npm run dev
```

Queda en `http://localhost:5173`.

### Probarlo

1. Entrar a <http://localhost:5173/forgot-password>.
2. Escribir el email de un usuario existente, por ejemplo `cliente@test.com`.
3. Ir a <http://localhost:8025> y abrir el email. El botón del enlace apunta a `http://localhost:5173/reset-password?token=...`.
4. Poner una contraseña nueva, enviarla y esperar el redirect a `/login`.
5. Entrar con la contraseña nueva. **La anterior ya no sirve**, y cualquier sesión que estuviera abierta se cerró.

Para probar que no se pueden enumerar cuentas, pedir un enlace con un email que no existe: la respuesta tiene que ser idéntica y no se debe crear ningún email en Mailpit.

### Restricción para tener en cuenta al probar

El rate limit de producción es de **3 solicitudes por hora**, contado por IP y por email. Es deliberado, pero en desarrollo estorba: todas las peticiones salen de `127.0.0.1`, así que con el valor de producción se agota con unas pocas pruebas manuales y bloquea al que está desarrollando, no a nadie sospechoso.

Por eso **`.env.development` tiene límites más laxos** (20 por IP, 10 por email). `.env.example` conserva los valores de producción y explica la diferencia.

En desarrollo, si aun así se agota, hay dos salidas: subir los valores en `.env.development` o simplemente **reiniciar el backend**. El limitador usa el almacén en memoria de `express-rate-limit`, así que el contador vive en el proceso del servidor y se reinicia con él.

> El almacén en memoria también implica que el límite **no se comparte entre instancias**: con varias réplicas cada una lleva su propio contador y el límite real es la suma. Si algún día se despliega con más de una instancia, hay que migrar a un almacén compartido (Redis).

**Nunca desactiven el rate limit (`RATE_LIMIT_ENABLED=false`) en un entorno compartido.**

### Correr los tests

```bash
# Backend: los 215
NODE_ENV=test npx jest --runInBand

# Solo los nuevos
NODE_ENV=test npx jest --runInBand password_reset email_service rate_limit

# Lint y build
npm run lint
npm run build
```

### Mantenimiento

La tabla `PasswordResetTokens` crece de forma indefinida porque los tokens no se borran solos:

```bash
npm run limpiar:tokens               # borra
npm run limpiar:tokens -- --dry-run  # solo muestra cuántos borraría
```

Borra los tokens usados o invalidados con más de 30 días, y los expirados con más de 7. Nunca toca los vigentes. Es idempotente, así que se puede correr todas las noches sin riesgo.

**El proyecto no tiene scheduler, así que en producción hay que agendarlo con cron.** Es el paso que falta si esto se despliega.

### Si algo falla

- **No llega ningún email.** Revisar que Mailpit esté arriba (`docker ps`) y que `MAIL_TRANSPORT=smtp`. Con la variable vacía el envío se omite a propósito y queda un aviso en la consola del backend.
- **La página dice que el enlace venció.** Verificar la hora del sistema: la vigencia son 10 minutos.
- **Devuelve 429.** Se alcanzó el límite por IP o por email. Esperar la ventana o ajustar el `.env`.
- **El enlace no encuentra la página.** La ruta del frontend es `/reset-password` y tiene que coincidir con el `FRONTEND_URL` con el que arma el enlace el backend. Si se cambia una, hay que cambiar las dos.
- **Faltan variables de entorno.** Sin `FRONTEND_URL` el enlace se arma con un valor por defecto que puede no ser el correcto.
