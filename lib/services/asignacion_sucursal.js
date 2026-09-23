/**
 * Service: asignacion_sucursal
 *
 * Asigna automáticamente la sucursal óptima según la menor carga de pedidos pendientes
 * (espejo del frontend src/services/asignacionSucursal.js).
 */

export function asignarSucursalOptima(sucursales, pedidosPendientes) {
  const activas = (sucursales || []).filter((s) => {
    if (s.activa !== undefined) return s.activa === true;
    if (s.estado !== undefined) return s.estado === 'activo';
    return true;
  });
  if (activas.length === 0) return null;

  const ordenadas = [...activas].sort((a, b) => a.id - b.id);
  const conteo = new Map(ordenadas.map((s) => [s.id, 0]));
  (pedidosPendientes || []).forEach((p) => {
    const sid = p.sucursalId ?? p.sucursal?.id;
    if (conteo.has(sid)) conteo.set(sid, conteo.get(sid) + 1);
  });

  let mejor = ordenadas[0];
  ordenadas.forEach((s) => {
    if (conteo.get(s.id) < conteo.get(mejor.id)) mejor = s;
  });
  return mejor;
}
