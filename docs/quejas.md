# Reclamos del cliente sobre pedidos entregados

Documenta la entidad `Queja`, sus reglas de negocio, la máquina de estados, los endpoints y la integración con el frontend.

> **Alcance:** el canal de reclamos se autorizó explícitamente aunque no figuraba en el modelo aprobado. No se implementaron `Repartidor`, `Notificacion` ni el rol `REPARTIDOR`. La queja es un reclamo operativo con respuesta del negocio; no reemplaza a `Resena` ni a `PedidoEstadoHistorial`.

## 1. Modelo

Entidad `Queja` (tabla `Quejas`), definida en `docs/DER.md` §2.23 y `docs/modelo-dominio.md` §5.19:

| Columna           | Tipo    | Regla                                                          |
| ----------------- | ------- | -------------------------------------------------------------- |
| `id`              | INTEGER | PK                                                             |
| `usuarioId`       | INTEGER | FK → `Usuario.id`, NOT NULL; CLIENTE autor                     |
| `pedidoId`        | INTEGER | FK → `Pedido.id`, NOT NULL, UNIQUE; pedido propio `entregado`  |
| `motivo`          | ENUM    | NOT NULL; ver motivos abajo                                    |
| `detalle`         | TEXT    | NOT NULL, 10 a 1000 caracteres                                 |
| `estado`          | ENUM    | NOT NULL, default `PENDIENTE`; incluye `CERRADA`               |
| `respuesta`       | TEXT    | NULLABLE, máximo 1000 caracteres; última respuesta del negocio |
| `respondidoPorId` | INTEGER | FK → `Usuario.id`, NULLABLE; admin/superadmin que respondió    |
| `respondidaEn`    | DATE    | NULLABLE; se completa al responder                             |
| `cerradaEn`       | DATE    | NULLABLE; se completa cuando el cliente cierra el reclamo      |
| `createdAt`       | DATE    | NOT NULL                                                       |
| `updatedAt`       | DATE    | NOT NULL                                                       |

Hilo (`QuejaMensajes`): una fila por respuesta, con `quejaId`, `autorId`, `contenido` y timestamps. La respuesta del negocio se guarda además en `respuesta` para compatibilidad.

Motivos (`motivo`):

- `PEDIDO_INCOMPLETO`
- `PRODUCTO_EN_MAL_ESTADO`
- `DEMORA_EN_LA_ENTREGA`
- `ERROR_DE_COBRO`
- `OTRO`

Restricciones de base: FK `ON DELETE RESTRICT`, UNIQUE `pedidoId`, índices por `usuarioId` y `estado`, y CHECK del dominio de `estado` además del ENUM.

## 2. Reglas de negocio

- **Autor**: solo un `CLIENTE` autenticado crea quejas. ADMINISTRADOR y SUPERADMINISTRADOR reciben 403.
- **Pedido reclamable**: debe pertenecer al cliente y estar en estado `entregado`. Un pedido ajeno responde 404; uno propio en otro estado responde 403.
- **Una por pedido**: UNIQUE `pedidoId`. Un segundo reclamo sobre el mismo pedido responde 409.
- **Detalle obligatorio**: entre 10 y 1000 caracteres, recortado de espacios al guardar.
- **Inmutabilidad del motivo**: el cliente no edita ni elimina la queja original.
- **Respuestas del cliente**: puede responder hasta 5 veces; cada respuesta queda en el hilo. Si la queja estaba `RESUELTA` o `RECHAZADA`, vuelve a `PENDIENTE` (reaparece en la bandeja y en el badge).
- **Mensajes del negocio**: el ADMINISTRADOR o SUPERADMINISTRADOR puede sumar mensajes al hilo **sin cambiar de estado**. Se actualiza `respuesta`, `respondidoPorId` y `respondidaEn`, pero la queja sigue `PENDIENTE` o `EN_REVISION`. Es lo que permite la bandeja tipo chat. En `RESUELTA`, `RECHAZADA` o `CERRADA` no se admiten mensajes del negocio.
- **Cierre del cliente**: puede cerrar el reclamo en cualquier estado; pasa a `CERRADA` (final). No admite más respuestas ni cambios del negocio.
- **Alcance de la bandeja**:
  - `ADMINISTRADOR`: ve y responde las quejas de pedidos de su sucursal (`Pedido.sucursalId`).
  - `SUPERADMINISTRADOR`: ve todas y puede filtrar por `sucursalId`.
  - Una queja fuera del alcance responde 404 (no se revela que existe).

## 3. Máquina de estados

```
PENDIENTE ──> EN_REVISION ──> RESUELTA
    │                │
    └────────────────┴──────> RECHAZADA

Cualquier estado (salvo CERRADA) ──> CERRADA   (cierre del cliente)
RESUELTA / RECHAZADA ── respuesta del cliente ──> PENDIENTE
```

- `PENDIENTE`: estado inicial al crear la queja.
- `EN_REVISION`: el negocio tomó el reclamo.
- `RESUELTA` / `RECHAZADA`: el negocio respondió; son finales para el negocio, pero el cliente puede reabrirlas respondiendo.
- `CERRADA`: cierre del cliente; nadie puede responder ni reabrir.
- Se permite cerrar directamente desde `PENDIENTE`.
- Un mensaje del negocio sin `estado` no mueve la máquina: el reclamo permanece en `PENDIENTE` o `EN_REVISION`.
- Al pasar a `RESUELTA` o `RECHAZADA`, `respuesta` es obligatoria (máximo 1000 caracteres). Se guardan `respondidoPorId`, `respondidaEn` y un mensaje en el hilo.
- Pasar a `EN_REVISION` no exige respuesta; si se envía, se guarda junto con el respondedor y la fecha.

## 4. Endpoints

Todas las rutas requieren sesión y CSRF en los métodos que cambian estado.

### 4.1 Crear

`POST /api/quejas` — solo `CLIENTE`.

```json
{
  "pedidoId": 42,
  "motivo": "PEDIDO_INCOMPLETO",
  "detalle": "Faltó la bebida y las papas del combo."
}
```

Responde 201 con la queja creada (`RespuestaQueja`).

### 4.2 Mis quejas

`GET /api/quejas/mias?pedidoId=42` — solo `CLIENTE`. `pedidoId` es opcional y filtra por ese pedido.

```json
{
  "success": true,
  "data": [
    {
      "id": 7,
      "pedidoId": 42,
      "motivo": "PEDIDO_INCOMPLETO",
      "detalle": "Faltó la bebida y las papas del combo.",
      "estado": "EN_REVISION",
      "respuesta": null,
      "respondidaEn": null,
      "creadaEn": "2026-11-02T18:30:00.000Z",
      "actualizadaEn": "2026-11-02T19:00:00.000Z",
      "pedido": {
        "id": 42,
        "fechaHora": "2026-11-01T20:15:00.000Z",
        "total": "15200.00"
      }
    }
  ]
}
```

### 4.3 Bandeja

`GET /api/quejas?estado=&q=&sucursalId=&pagina=&limite=` — `ADMINISTRADOR` o `SUPERADMINISTRADOR`.

- `estado`: opcional, uno de los cinco estados.
- `q`: búsqueda libre por nombre/apellido/email del cliente o por id de pedido.
- `sucursalId`: solo lo respeta el SUPERADMINISTRADOR; el ADMINISTRADOR queda fijo en su sucursal.
- `pagina` (default 1) y `limite` (default 10, máximo 50).

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 7,
        "motivo": "PEDIDO_INCOMPLETO",
        "detalle": "Faltó la bebida y las papas del combo.",
        "estado": "PENDIENTE",
        "respuesta": null,
        "respondidaEn": null,
        "creadaEn": "2026-11-02T18:30:00.000Z",
        "pedido": {
          "id": 42,
          "fechaHora": "2026-11-01T20:15:00.000Z",
          "total": "15200.00",
          "sucursal": { "id": 2, "nombre": "Palermo" }
        },
        "cliente": {
          "id": 15,
          "nombre": "Ana",
          "apellido": "Gómez",
          "email": "ana@demo.com"
        },
        "respondidoPor": null
      }
    ],
    "total": 1,
    "pagina": 1,
    "paginas": 1,
    "limite": 10
  }
}
```

### 4.4 Responder / cambiar estado

`PUT /api/quejas/:id` — `ADMINISTRADOR` o `SUPERADMINISTRADOR`.

```json
{
  "estado": "RESUELTA",
  "respuesta": "Se reintegró el valor de la bebida y las papas por el mismo medio de pago."
}
```

Responde 200 con la queja actualizada. Para `EN_REVISION` la respuesta es opcional; para `RESUELTA` y `RECHAZADA` es obligatoria y queda registrada en el hilo.

`estado` es opcional. Sin `estado`, el cuerpo es un mensaje suelto del negocio:

```json
{
  "respuesta": "Estamos revisando el pedido con la sucursal."
}
```

En ese caso se agrega el mensaje al hilo y se actualizan `respuesta`, `respondidoPorId` y `respondidaEn`, pero **no cambia el estado**. Solo se admite mientras la queja esté `PENDIENTE` o `EN_REVISION`.

### 4.5 Responder (cliente)

`POST /api/quejas/:id/mensajes` — solo el `CLIENTE` dueño.

```json
{ "contenido": "Sigue sin llegarme el reintegro." }
```

Responde 201 con la queja y su hilo. Tope de 5 respuestas del cliente (409 al superarlo). Reabre a `PENDIENTE` si estaba `RESUELTA` o `RECHAZADA`.

### 4.6 Cerrar (cliente)

`POST /api/quejas/:id/cerrar` — solo el `CLIENTE` dueño. Pasa la queja a `CERRADA` con `cerradaEn`. Es final.

### 4.7 Errores

| Status | Caso                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Motivo inválido, detalle fuera de 10..1000, respuesta faltante o > 1000, mensaje faltante sin `estado`, transición inválida, estado inválido |
| 401    | Sin sesión                                                                                                                                   |
| 403    | Rol distinto de `CLIENTE` al crear o responder, pedido propio no entregado                                                                   |
| 404    | Pedido inexistente o ajeno, queja inexistente o fuera del alcance                                                                            |
| 409    | El pedido ya tiene una queja, queja `CERRADA` o tope de respuestas alcanzado                                                                 |

El controller traduce `QuejaError.codigo` al status HTTP; cualquier otro error sigue el middleware general (500).

## 5. Frontend

- `src/api/quejas.js` — `crearQueja`, `obtenerMisQuejas`, `obtenerQuejas`, `actualizarQueja`, `enviarMensajeQueja`, `responderQueja`, `cerrarQueja`.
- `src/utils/constants.js` — `MOTIVOS_QUEJA`, `ESTADOS_QUEJA` (incluye `CERRADA`), `ETIQUETAS_MOTIVO_QUEJA`, `ETIQUETAS_ESTADO_QUEJA` y variantes de badge.
- `src/components/cliente/FormularioQueja.jsx` — select de motivo y detalle con validación de longitud.
- `src/components/cliente/QuejaModal.jsx` — modal que monta el formulario recién al abrir.
- `src/pages/cliente/DetallePedido.jsx` — en pedidos `entregado`, tarjeta "Reclamos": sin queja ofrece "Hacer un reclamo"; con queja muestra el hilo, permite responder (hasta 5) y cerrar. Escucha `queja_actualizada` para refrescar el hilo.
- `src/pages/admin/GestionQuejas.jsx` — bandeja compartida en `/admin/quejas`. Es un espacio de conversaciones: lista de chats con búsqueda, filtros por estado y sucursal (solo superadmin), contador de mensajes sin responder y panel de conversación con el hilo completo y el compositor. El compositor permite responder sin cambiar de estado o elegir la transición (`EN_REVISION`, `RESUELTA`, `RECHAZADA`). Componentes en `src/components/admin/quejas/`.
- `src/hooks/useIndicadoresNav.js` — badge y pulso del ícono de Reclamos: cuenta las quejas `PENDIENTE` por REST y se refresca con `queja_actualizada`.
- `src/routes/AppRoutes.jsx` y `src/components/comunes/Navbar.jsx` — ruta y entradas de menú para ADMINISTRADOR y SUPERADMINISTRADOR. La barra inferior (`NavInferior.jsx`) muestra Reclamos en ambos roles; el ADMINISTRADOR entra a Clientes desde el botón "Ver clientes" del panel de reportes.

La elegibilidad del frontend es solo informativa: el backend vuelve a validar el pedido entregado, la propiedad y la unicidad en cada alta.

## 6. Datos demo

No hay seeder de quejas. Se prueba con las cuentas demo (`@demo.com`, contraseña `123456`) y sus pedidos `entregado`, o con `cliente@test.com` / `123456` generando un pedido y avanzándolo hasta `entregado` desde el panel.

## 7. Tiempo real

El canal WebSocket avisa que una queja se creó o cambió con el evento `queja_actualizada` (detalle en `docs/webSocketContext.md` §6.7).

- **Emisor:** `lib/services/quejas.js`, al crear, al actualizar, al responder el cliente y al cerrar, mediante `emitirQuejaActualizada(quejaId, sucursalId, pedidoId)`.
- **Destino:** room `admins` (SUPERADMINISTRADOR) y `sucursal:{id}` del pedido. El ADMINISTRADOR recibe solo su sucursal y el SUPERADMINISTRADOR todas.
- **Payload:** `{ quejaId, pedidoId, sucursalId }`. El dato se relee por REST.
- **Efecto en la UI:** el badge del ícono de Reclamos cuenta las quejas `PENDIENTE`; la bandeja abierta se recarga sola y `DetallePedido` refresca el hilo.
- **Tests:** `lib/realtime/conexion.test.js`, bloque "Aviso de quejas (reclamos)" — creación, actualización, respuesta del cliente y cierre, con aislamiento por sucursal.
