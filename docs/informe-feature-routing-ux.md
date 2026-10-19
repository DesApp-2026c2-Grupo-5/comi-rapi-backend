# Informe de feature — Routing seleccionable, checkout optimizado y mejoras de UX

> Documenta el trabajo de la rama `feat/routing-proveedores`. Incluye un glosario al final para los conceptos técnicos.

---

## 1. Qué se hizo y por qué

### El problema del checkout lento

Cada vez que un cliente confirmaba un pedido, la aplicación llamaba a un servicio de mapas externo (OpenRouteService) **una vez por sucursal**, una después de la otra, para preguntar "¿a cuánto está esta sucursal de la dirección de entrega?". Con 3 sucursales, el "finalizar compra" tardaba **entre 2,4 y 3,1 segundos** y el "confirmar pago" casi 1 segundo más. Además, ese servicio gratuito tiene un cupo limitado de llamadas por minuto: en una demo con varios pedidos seguidos, se puede agotar y romper la app.

### La solución

Cuando un cliente registra su dirección, la app ya llama al servicio de mapas para validar la cobertura (siempre lo hizo). Lo nuevo es que ahora **anota el resultado** en una tabla propia de la base de datos (`DistanciasRutas`), en vez de tirarlo. Como la distancia entre dos puntos fijos no cambia con el tiempo, una vez anotada sirve para siempre.

Al crear un pedido, la app mira la tabla: si la distancia ya está anotada, **no llama a nadie** y responde casi al instante. Si falta una anotación (por ejemplo, abrieron una sucursal nueva), hace solo esa llamada y la anota.

**Resultado medido**: el checkout completo pasó de **~3,3 segundos** a **~200-400 milisegundos**.

---

## 2. Proveedores de routing seleccionables

Se agregó **Geoapify** como alternativa a OpenRouteService (ORS). Ambos viven detrás del mismo contrato de código: cambiar de uno al otro es una variable de configuración (`ROUTING_PROVIDER=geoapify` o `ors`), sin tocar código ni hacer deploy.

El proveedor ORS migró su URL a un dominio nuevo de HeiGIT (`api.heigit.org/openrouteservice`); la vieja se apaga en noviembre 2026. Ese cambio se integró sin conflicto con la nueva arquitectura.

**Verificación en paralelo**: mismo par de coordenadas con ambos proveedores → dentro del radio de cobertura el desvío es 0-1%. La app no reutiliza las distancias de un proveedor para el otro (cada fila del caché lleva su proveedor en la clave).

---

## 3. Mapa al validar una dirección

Cuando el cliente hace clic en **"Verificar dirección"**, además del resultado textual ahora se muestra un **mapa interactivo**:

- **Con cobertura**: un círculo azul marca "Tu dirección" y pines muestran hasta 3 sucursales dentro del radio de 5 km, con su distancia por ruta.
- **Sin cobertura**: el círculo azul de tu dirección + la sucursal más cercana (fuera de radio) con el mensaje "Tu sucursal más cercana es X, fuera de cobertura (5 km)".

El mapa usa tiles de **CyclOSM** (gratuitos, sin API key, sin límites de uso) con la librería react-leaflet. La página se desliza automáticamente hasta el resultado cuando aparece.

---

## 4. Hora estimada de llegada (ETA)

Antes: el pedido mostraba un badge "~35 min" (estimado total: cocina + viaje, calculado al pagar) que era confuso y estático.

Ahora: cuando el admin marca el pedido como **"en camino"**, el backend persiste la **hora absoluta de llegada** (`horaEstimadaLlegada`: ahora + duración del viaje, tomada del caché). El cliente ve un cartel verde prominente:

> **Tu pedido está en camino**
> Tu pedido llega a las 14:32 aproximadamente

Es una hora fija, no un contador que decrece — la hora no cambia porque ya fue calculada. El badge celeste "~35 min" fue eliminado; el contador de minutos bajo cada estado del historial ahora solo es visible para el admin (el cliente ve el flujo limpio).

Si el servicio de mapas falla al calcular la hora, el pedido pasa a en_camino igual (sin hora: el frente muestra "—") — el reparto nunca se bloquea por una falla del proveedor.

---

## 5. Mejoras del carrito

### Botón flotante

Un círculo naranja con el conteo de items aparece abajo-derecha mientras navegás el catálogo. Te lleva directo al carrito con un clic. Desaparece cuando el carrito está vacío o ya estás en la página del carrito.

### Botones de cantidad

El campo numérico editable fue reemplazado por botones: `[🗑️|−] [ 2 ] [+]`. Si la cantidad es 1, el botón izquierdo es un tacho (elimina el producto); si hay más de una unidad, es un signo menos. No se puede escribir a mano.

### Botón "Buscar más productos"

Al lado de "Vaciar carrito", un botón que te lleva al catálogo sin perder lo que ya tenés en el carrito.

### Responsividad

En pantallas angostas (<768px), el ítem del carrito pasa a dos filas: imagen + nombre arriba, cantidad + subtotal abajo. Sin solapamientos.

---

## 6. Deslizador doble de precio

Los dos campos numéricos de precio mínimo/máximo en el catálogo fueron reemplazados por un **deslizador doble** (dos controles deslizables superpuestos). El rango seleccionado se resalta en naranja sobre la pista gris, y los límites se calculan de los precios reales de los productos cargados.

---

## 7. Panel del admin

- **Badge de sucursal**: cada admin ve su sucursal asignada en un pill naranja en la barra superior, siempre visible. Responde al feedback del profesor de que "cada uno debe saber a qué sucursal pertenece".
- **Credenciales demo en el login**: el login del admin muestra las cuentas de prueba por renglón (una por sucursal + superadmin).

---

## 8. Datos de demostración (seeds)

Tras un `reset-db`, la base arranca con:

| Entidad                   | Datos                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 3 sucursales              | Oeste (J.M. de Rosas 600), Palermo (Av. Santa Fe 3253), **Vergara** (AV GDOR VERGARA 3547, Hurlingham)      |
| 2 direcciones del cliente | Casa = Vergara 1593 (Oeste a 1,6 km, Vergara a 2,7 km → reasignación jugable) · Trabajo = Av. Santa Fe 3700 |
| 3 admins                  | `admin@jmderosas.com` (Oeste), `admin@santafe.com` (Palermo), `admin@vergara.com` (Vergara)                 |
| 4 pedidos demo            | Con coordenadas, estados completos, ETA y hora de llegada                                                   |
| Stock                     | Todos los productos en las 3 sucursales; Vergara sin Papas Cheddar (para probar reasignación)               |
| Parámetros                | Radio 5 km, mínimo $2.000, envío $350, etc.                                                                 |

El superadmin se crea aparte con `npm run crear:superadmin` (paso documentado en `docs/reset-db.md`).

---

## 9. Verificación ejecutada

| Chequeo                        | Resultado                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Suite backend completa         | **43/43 suites · 627/627 tests**                                                           |
| Build backend (Babel)          | 138 archivos ✓                                                                             |
| Build frontend (Vite)          | ✓                                                                                          |
| Validación e2e de reasignación | 32/32 verificaciones (ORS + Geoapify): auto, manual, negativos, <500 ms con caché caliente |
| Smoke de proveedores           | Distancias idénticas dentro del radio (0-1% drift)                                         |
| Migraciones                    | 3 nuevas aplicadas en dev y test                                                           |

---

## 10. Limitaciones conocidas

1. **Bug de datos de Georef**: en AV GDOR VERGARA (Hurlingham), las alturas 1800-2400 y 3000-3200 geocodifican ~3,4 km al norte de su ubicación real. No es un bug de la app ni del routing — es un vacío de datos en la base de Georef Argentina. Las alturas 1593-1598 y 2600-2800 funcionan correctamente.
2. **Caché frío tras cambiar de proveedor**: el primer checkout por dirección recalcula sus pares (igual que el comportamiento anterior a la optimización). Después, instantáneo.
3. **Suite de tiempo real inestable**: `conexion.test.js` hace llamadas reales a ORS sin mockear (preexistente, no introducido por este trabajo).

---

## Glosario

**Caché de distancias** (`DistanciasRutas`): una tabla de la base de datos que guarda el resultado de cada cálculo de distancia por ruta. Cuando la app necesita saber "¿a cuánto está la sucursal X de la dirección Y?", primero mira esta tabla. Si ya está guardado, responde en milisegundos sin llamar a ningún servicio externo. Si no está, hace la llamada, guarda el resultado, y la próxima vez es instantáneo. Es como anotar en una libreta el resultado de una consulta que ya hiciste, para no repetirla.

**Cobertura (radio de 5 km)**: la regla de negocio que dice que una dirección solo puede recibir pedidos si hay al menos una sucursal activa a menos de 5 kilómetros **por ruta** (no en línea recta) de la dirección de entrega. Es la distancia que realmente va a manejar el repartidor.

**ETA (Estimated Time of Arrival)**: el tiempo estimado de entrega. En esta app se calcula como `cocina (30 min fijos) + viaje (duración por ruta según el servicio de mapas)`. Se muestra en minutos como estimación total desde que se confirma el pedido.

**Hora estimada de llegada** (`horaEstimadaLlegada`): a diferencia del ETA (que es una cantidad de minutos), esta es una **hora concreta** (ej: "14:32") que se calcula cuando el pedido pasa a estado "en camino". Se obtiene sumando la duración del viaje a la hora actual. Es el dato que ve el cliente como "Tu pedido llega a las 14:32 aproximadamente".

**Fail-closed**: política de seguridad ante fallas. Si el servicio de mapas no responde y no hay distancia en el caché, la app **no asigna ninguna sucursal** — informa el error y el pedido queda sin confirmar. Nunca "aproxima" una distancia ni asigna una sucursal arbitraria "para que no falle".

**Georef Argentina**: el servicio público del gobierno argentino que convierte direcciones textuales ("Av. Santa Fe 3700") en coordenadas de mapa (latitud/longitud). Es gratuito, sin API key, y específico para direcciones argentinas.

**Geoapify / OpenRouteService (ORS)**: dos servicios externos que calculan distancias y duraciones **por ruta** (siguiendo calles reales, no línea recta) entre dos coordenadas. ORS es el proveedor histórico (migrado a HeiGIT, `api.heigit.org`); Geoapify es la alternativa que se agregó. Ambos son gratuitos con cuotas limitadas.

**Lazy**: cuando falta una distancia en el caché, se calcula "en el momento" (lazy) en vez de pre-calcular todas las combinaciones de antemano. Solo se paga el costo la primera vez.

**Leaflet / react-leaflet**: la librería de JavaScript que dibuja mapas interactivos en el navegador. `react-leaflet` es su adaptador para React. Los "tiles" son las imágenes que componen el fondo del mapa (las porciones de calle/terreno que se descargan del proveedor de mapas).

**Snapshot de dirección**: cuando se crea un pedido, la dirección de entrega se copia (calle, altura, ciudad, coordenadas) al registro del pedido. Si el cliente cambia o borra su dirección después, el pedido conserva los datos del momento en que lo hizo — como una foto.

**Tiles CyclOSM**: las imágenes que componen el fondo del mapa. CyclOSM es un estilo de OpenStreetMap con terreno suave y colores limpios, gratuito y sin API key.

**Trazabilidad**: cada vez que un pedido cambia de sucursal (reasignación automática o manual), se registra en el historial quién lo hizo, desde qué sucursal y hacia cuál: "Reasignado de 'Sucursal Oeste' a 'Sucursal Vergara' por admin admin@test.com".
