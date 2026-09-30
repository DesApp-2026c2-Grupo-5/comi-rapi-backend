# ¿Cómo funciona el sistema de sesiones de Comi-Rapi? (Explicado para todos)

Imaginá que la aplicación es **un parque de diversiones** y que el servidor (el
back-end) es **la administración del parque**. Todo lo que se cuenta acá
funciona así: cuando entrás al parque te dan una **pulsera**, y mientras la
lleves puesta, los empleados saben quién sos y qué tenés permitido hacer. Sin
pulsera, te tratan como a cualquier extraño en la calle.

---

## La idea principal en una frase

> El parque (el servidor) guarda un **registro de quién lleva cada pulsera**.
> La pulsera en sí (la **cookie**) no tiene datos importantes: solo sirve para
> que el parque mire en sus registros y diga "ah, sí, esta pulsera es de Ana".

Esto se llama **sesión del lado del servidor** ("server-side session").
La información "importante" (quién sos) **no se guarda en el navegador**: se
guarda en la base de datos del parque. El navegador solo tiene una referencia
(a la pulsera) para que el parque pueda encontrarla.

---

## Las cookies: qué son realmente

Una cookie es un **texto diminuto que el navegador guarda en su cajita
personal** (el "baúl de cookies"), asociado a un sitio web. Tiene forma de
pareja `nombre=valor` y varias etiquetas que le dicen al navegador **cuándo y
cómo debe usarla**.

Una cookie de sesión típica de esta app se ve así por dentro:

```
comirapi.sid=s%3AbM2xKzb2p6W...; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800
```

| Etiqueta (atributo)           | Qué significa                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `comirapi.sid`                | El **nombre** de la pulsera. Cualquier cookie tiene nombre y apellido.                                                                       |
| `s%3AbM2x...`                 | El **valor**: un ID aleatorio gigante. Es la "matrícula" de la pulsera. No dice quién sos, solo _cuál_ pulsera es.                           |
| `Path=/`                      | El camino del sitio para el que aplica. Con `/` vale para todo el sitio.                                                                     |
| `HttpOnly`                    | **No se puede leer ni modificar con JavaScript.** Solo el navegador la manda, automáticamente, cuando habla con el sitio.                    |
| `SameSite=Lax`                | Solo viaja cuando la petición viene _desde el mismo sitio_ (sobre todo en pedidos que cambian datos). Un sitio externo no la puede disparar. |
| `Max-Age=28800`               | Vence en 28 800 segundos = **8 horas**. Después, el navegador la tira a la basura.                                                           |
| `Secure` (solo en producción) | La pulsera solo viaja por HTTPS (conexión cifrada), nunca por HTTP simple.                                                                   |

**La regla de oro del navegador con las cookies:**

> Cuando el navegador visita un sitio, **agrega automáticamente** todas las
> cookies que ese sitio le dio antes. Vos no hacés nada; el chófer (el
> navegador) las pone en el sobre sin consultar.

Del lado del servidor, una petición con cookie se ve así en los headers HTTP:

```
POST /api/pedidos
Host: localhost:3000
Cookie: comirapi.sid=s%3AbM2xKzb2p6W...
x-csrf-token: 9f8a2c5b...      ← este es el código CSRF (lo vemos más abajo)
Content-Type: application/json
```

---

## Esta app usa DOS pulseras distintas (no confundir)

|                             | `comirapi.sid`                                                | `csrf-token`                                                              |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Para qué sirve**          | Saber **quién sos** (identifica la sesión en el servidor).    | Saber que la acción la pediste **vos, desde esta web** (protección CSRF). |
| **Qué contiene**            | Un ID aleatorio que apunta a un registro en la base de datos. | Un token aleatorio de 64 caracteres.                                      |
| **¿HttpOnly?**              | **Sí** → el JavaScript del front-end _no_ puede leerla.       | **No** → el front-end _tiene que_ poder leerla (la manda como header).    |
| **¿Se usa en cada pedido?** | Sí, automáticamente en todos.                                 | Solo en pedidos que **cambian algo** (POST/PUT/PATCH/DELETE).             |
| **Dónde se genera**         | En el servidor al iniciar sesión.                             | En `GET /api/auth/csrf-token`.                                            |

La primera dice **"quién es"**; la segunda dice **"esa petición no es un
engaño"**. Son complementarias y requieren la una de la otra para que un
pedido "serio" sea aceptado.

---

## La cookie de sesión paso a paso

### 1. Te registrás o iniciás sesión

- Vos escribís tu email y tu contraseña en la pantalla de "Iniciar Sesión".
- Tu navegador le manda un mensaje al servidor: **"¿podés verificar que estas
  credenciales son correctas?"**.
- El servidor revisa en su archivo de usuarios y, si la contraseña coincide,
  responde: **"correcto, te doy una pulsera"**.

### 2. El parque te da la pulsera

El servidor:

1. **Anota en sus registros**: "la pulsera `ABC123` le pertenece al usuario 42".
   Ese registro vive en una tabla de la base de datos llamada `session`.
   En esa tabla se guarda el ID aleatorio (`sid`), los datos de la sesión como
   `usuarioId`, y la fecha de vencimiento (`expire`).
2. **Le da la pulsera a tu navegador** mediante la respuesta de HTTP (el
   header `Set-Cookie`). El navegador la guarda en su cajita de cookies.

**Detalle clave**: la pulsera es **HttpOnly**. El JavaScript del front-end no
puede ni siquiera _leer_ qué dice. Si un atacante lograra inyectar código en la
página (un ataque llamado XSS), **no podría copiar la cookie y hacerse pasar
por vos**. El navegador la guarda y la manda sola; nadie más la ve.

Otra cosa importante: cuando te autenticás, el servidor **regenera** la sesión
(`req.session.regenerate()`): te da una pulsera **nueva** y destruye cualquier
pulsera anterior en la base de datos. Así se evita el "session fixation", un
truco en el que un atacante te entrega una pulsera vieja con su matrícula y
espera que, al identificarte, la uses y él pueda usarla también.

### 3. Cada cosa que pedís mientras estás adentro

Cuando hacés clic en "Ver mi carrito", el navegador manda:

1. El mensaje ("quiero ver mi carrito").
2. **La pulsera automáticamente** (el navegador la agrega sola, no tenés que
   hacer nada).

El servidor recibe los dos, mira la pulsera, busca esa pulsera en sus registros
y dice "esta pulsera es de Ana, le dejo ver el carrito". Si la pulsera no
existe o ya venció, responde: "no estás registrado, andá a iniciar sesión".

### 4. Te vas del parque (cerrar sesión)

Cuando tocás "Cerrar sesión", el navegador le avisa al servidor. El servidor:

1. **Borra el registro** de esa pulsera de su base de datos (la pulsera queda
   invalidada, aunque alguien la copiara ya no sirve).
2. Le pide al navegador que **se quite la pulsera** (borra la cookie
   `comirapi.sid`).

### 5. Cerrás la app y volvés al día siguiente

Como la pulsera es una cookie, tu navegador la **sigue guardando** aunque
cierres la pestaña. Al volver a abrir la app, el front-end le pregunta al
servidor **"¿quién soy?"** (la ruta `GET /auth/me`). El servidor mira la
pulsera, consulta sus registros y responde "sos Ana, te dejo pasar". Por eso
no necesitás iniciar sesión de nuevo.

---

## El CSRF: la protección contra el "engaño de la pulsera"

### ¿Qué es un ataque CSRF?

CSRF (Cross-Site Request Forgery) es un truco donde **un sitio malicioso usa
tu sesión sin que vos te des cuenta**. Como el navegador _siempre_ manda la
cookie cuando habla con el sitio, un sitio malvado puede esconder un
formulario o una imagen que le pida al parque algo en tu nombre:

```
Vos entrás a www.sitio-malvado.com
  └─ esa página, sin que lo sepas, le manda al parque:
      "POST /api/pedidos"  ← con TU pulsera (cookie) puesta
```

Si el parque confiara solo en la pulsera, aceptaría el pedido pensando que fuiste
vos. **La cookie no alcanza** para demostrar "yo estoy apretando el botón".

### ¿Cómo lo arregla esta app? El "doble sello" (double-submit)

La idea es simple: para hacer algo que **cambie datos**, no alcanza con mandar
la pulsera; hay que mandar también un **código secreto de dos copias**:

1. Una copia vive en la **cookie `csrf-token`** (la lee el JavaScript del
   front-end, por eso NO es HttpOnly).
2. La otra copia viaja en el **header `x-csrf-token`**.

El servidor acepta la petición **solo si ambas copias son exactamente iguales**:

```
✓ Cookie:    csrf-token=9f8a2c5b...
✓ Header:    x-csrf-token=9f8a2c5b...
  → COINCIDEN → "esta petición viene de la web real, adelante"

✗ Cookie:    csrf-token=9f8a2c5b...
✗ Header:    (no viene, o viene otro valor)
  → NO COINCIDEN → 403 "Solicitud no válida"
```

### ¿Por qué un atacante no puede falsificar el par cookie + header?

Este es el corazón de la defensa. Un sitio malvado podrá **mandar** peticiones,
pero no puede **fabricar el par completo**:

- **No puede escribir la cookie `csrf-token` del parque.** Las cookies solo las
  puede guardar el servidor de ese dominio (o el front-end sirviendo desde ese
  mismo dominio). Un sitio externo no tiene forma de programar una cookie en el
  dominio `localhost:3000`.
- **No puede leer la cookie `csrf-token` del parque.** Aunque el sitio malvado
  manda el código JS que corre en tu navegador, ese código corre _dentro del
  sitio malvado_, y por la regla de **mismo origen** no puede leer las cookies
  de otro sitio. Es como si el formulario malvado pidiera "mostrame la pulsera"
  a un empleado de otro parque: el empleado no le muestra nada.
- **No puede inventar el valor**, porque es un token aleatorio de 64 caracteres
  generado con criptografía (`crypto.randomBytes(32)`). Adivinarlo es
  prácticamente imposible.

Conclusión: la cookie y el header son **las dos llaves de una misma cerradura**,
y una de las dos siempre queda fuera del alcance de un sitio tercero.

### Cómo lo implementa exactamente esta app

1. Todo pedido que cambie datos (**POST/PUT/PATCH/DELETE**) es revisado por el
   middleware `csrfProtection`, que compara cookie vs header. Si no coinciden:
   respuesta **403**.
2. El front-end (`client.js`), antes de mandar un pedido de esos, consigue el
   token así:
   - Si ya existe la cookie `csrf-token`, la **lee** y la usa como header.
   - Si no existe, llama a **`GET /api/auth/csrf-token`**, que genera un token
     nuevo, lo guarda en la cookie y lo devuelve en la respuesta. Después lo
     usa como header.
3. Si el servidor devuelve **403** (el token se rotó o expiró), el `client.js`
   **reintenta una sola vez**: pide un token fresco y repite el pedido.
4. La cookie `csrf-token` expira junto con la sesión (mismo tiempo de vida),
   o sea que como mucho dura 8 horas.

Un ejemplo real de lo que manda el navegador en un login:

```
POST /api/auth/login
Cookie: csrf-token=9f8a2c5b...; comirapi.sid=s%3AbM2xKzb2p6W...
x-csrf-token: 9f8a2c5b...
Content-Type: application/json

{ "email": "ana@test.com", "password": "123456" }
```

---

## Los "guardianes invisibles": SameSite y CORS

Las cookies y el CSRF no trabajan solos; tienen dos ayudantes de base:

**SameSite=Lax** (va dentro de la propia cookie):

> Le dice al navegador "esta pulsera solo la muestres cuando la visita la
> hacemos nosotros". Una página externa que intente disparar un pedido que
> cambia datos, lo hace _sin_ tu cookie. Es la primera barrera contra CSRF;
> el doble sello del token es la segunda.

**CORS + `credentials: 'include'`** (reglas de admisión del parque):

> El servidor solo acepta peticiones desde el origen del front-end
> (`http://localhost:5173`) y con credenciales. El front-end, por su parte,
> configura su chófer para que mande las cookies entre dominios distintos
> (`credentials: 'include'`). Cualquiera que pretenda hablar al parque desde
> otra web, simplemente no entra por la puerta.

---

## ¿Qué es cada componente? (el "quién es quién" en esta película)

### Del lado del parque (back-end)

| Componente                            | Qué es                                                                                   | Analogía                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `express-session`                     | El organizador de pulseras. Crea la cookie, la renueva, la invalida.                     | El encargado de repartir pulseras en la entrada.                                                                                                                                      |
| `connect-pg-simple` + tabla `session` | El lugar donde se guardan los registros (en PostgreSQL).                                 | El libro de registros en las oficinas del parque.                                                                                                                                     |
| Middleware `verificarSesion`          | El vigilante que revisa tu pulsera en cada atracción y consulta el libro.                | El empleado que te pide la pulsera antes de subirte a la montaña rusa.                                                                                                                |
| `permitirRoles`                       | El segundo vigilante que revisa **qué tipo de pulsera** tenés (cliente o administrador). | El encargado que te deja pasar a la zona de adultos solo si tu pase dice "ADULTOS".                                                                                                   |
| `csrfProtection`                      | El guardaespaldas que compara el código de la cookie con el del header.                  | El empleado que exige ver las DOS copias del boleto antes de dejar pasar.                                                                                                             |
| `crypto.randomBytes(32)`              | El generador del código CSRF imposible de adivinar.                                      | La máquina que fabrica el sello secreto del boleto.                                                                                                                                   |
| `sesion.regenerate()`                 | Renueva tu pulsera por una **nueva** apenas entrás.                                      | En la entrada, tras verificar tu ticket, te dan una pulsera nueva y tiran la vieja a la basura. Así nadie puede fingir tener una pulsera vieja que no le corresponde.                 |
| `argon2`                              | La forma de guardar las contraseñas.                                                     | El parque no guarda tu huella, guarda una "versión revuelta" de ella. Para verificarte, revuelve lo que escribís y compara los dos resultados. Si coinciden, sos vos.                 |
| `authLimiter`                         | Limita la cantidad de intentos de login.                                                 | La puerta que se traba si alguien intenta adivinar la contraseña muchas veces seguidas.                                                                                               |
| CORS + SameSite                       | Reglas de "con quién habla el parque".                                                   | El parque solo le da la mano al público que lo visita desde la entrada oficial (el front-end en `localhost:5173`). Cualquiera que pretenda robarle datos desde otra web queda afuera. |

### Del lado del navegador (front-end)

| Componente           | Qué es                                                                                                                                                                                                                                                                           | Analogía                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `client.js`          | El chófer que hace TODOS los pedidos. Se encarga de: mandar la pulsera automáticamente (`credentials: 'include'`), buscar el código CSRF cuando hace falta (lo lee de la cookie o se lo pide al servidor) y repetir el pedido una vez si el parque dice "código inválido" (403). | El mozo que lleva tus pedidos a la cocina y vuelve con la respuesta.                                |
| `auth.js` (capa API) | Las instrucciones de "cómo pedir" cada cosa de autenticación (iniciar sesión, registrarse, salir, preguntar quién soy). También chequea que el rol que devolvió el servidor sea el correcto.                                                                                     | El manual de protocolo del parque: "para entrar por la puerta de clientes, hay que hacer tal cosa". |
| `AuthContext`        | La **memoria** de la app mientras está abierta: sabe si hay alguien conectado y quién es.                                                                                                                                                                                        | El "reloj marcador" en la entrada que dice "hoy está Ana adentro".                                  |
| `ProtectedRoute`     | Los **portones** de cada zona. Si no tenés pulsera te manda a la entrada (login). Si tenés pulsera de cliente y querés entrar a la zona de administración, te redirige a tu zona.                                                                                                | Los molinetes que controlan quién entra a cada sección.                                             |
| `useAuth`            | La forma en que cualquier pantalla pregunta "¿quién está adentro?".                                                                                                                                                                                                              | El locutor que repite "Ana está adentro" cada vez que una pantalla se lo pregunta.                  |

---

## El ciclo de vida de una pulsera (datos técnicos breves)

- Dura **480 minutos (8 horas)** por defecto, configurable con `SESSION_TTL_MIN`.
- Tiene `secure: true` solo en producción (se manda solo por HTTPS) y
  `sameSite: 'lax'`.
- La cookie `csrf-token` dura el mismo tiempo que la sesión.
- Si el administrador **desactiva** a un usuario, la pulsera no sirve más: en
  la siguiente petición, el servidor la borra de sus registros y responde
  "no autorizado".

---

## Diagrama rápido del viaje de una petición

```
1. Vos hacés clic en "Confirmar pedido"
        │
        ▼
2. El navegador manda:  pedido + pulsera (comirapi.sid)
   + código CSRF (cookie csrf-token + header x-csrf-token)
        │
        ▼
3. app.js aplica en orden:
     - Sesión: "¿existe esa pulsera?"   → sessionMiddleware
     - CSRF: "¿coinciden las dos copias del código?" → csrfProtection
     - Rutas: "¿a qué atracción va?"    → routes
        │
        ▼
4. La atracción usa middlewares:
     - verificarSesion → "¿quién es el dueño de la pulsera?"
     - permitirRoles  → "¿su pase le permite entrar acá?"
        │
        ▼
5. El controller atiende y devuelve la respuesta
        │
        ▼
6. La respuesta vuelve al navegador, que la muestra
```

---

## Resumen en 4 frases

1. **La sesión vive en el servidor** (base de datos), no en el navegador.
2. **El navegador solo guarda la cookie** `comirapi.sid` (HttpOnly), que es la
   "pulsera" que identifica la sesión. Es un ID aleatorio, no tus datos.
3. **Cada vez que cambiás algo** (login, registro, pedidos...), el servidor
   exige además las **dos copias del código CSRF** (cookie + header) para
   asegurarse de que la acción la pediste vos desde esta web y no un sitio
   ajeno que se disfraza de vos.
4. **La app recuerda tu sesión** al volver a abrirse porque le pregunta al
   servidor "¿quién soy?", mostrándole la pulsera que tu navegador aún
   conserva.
