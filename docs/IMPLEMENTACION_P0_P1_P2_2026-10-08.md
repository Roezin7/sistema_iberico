# Implementación P0/P1/P2 — 8 de octubre de 2026

## P0

- La pantalla Operación usa `/api/operacion/resumen`, una lectura agregada para
  semana, salud, ventas, conciliaciones, tareas, inventario y compras.
- La lista de compras se deriva del mismo cálculo de inventario; no vuelve a
  leer lotes y consumos por separado.
- `inventarioActual` comparte las lecturas en vuelo aunque se solicite la vista
  física u operativa.
- La ruta directa de compra ahora exige origen de pago y crea compra, lote FIFO,
  movimiento financiero y factura bancaria en la misma transacción.
- Se agregó una prueba de contrato para el resumen agregado.

## P1

- Movimientos y arqueos ya no aceptan fechas fuera de la semana seleccionada.
- Se agregó una bitácora transversal `auditoria_eventos` con entidad, acción,
  usuario, fecha y estado anterior/posterior.
- Se auditan compras confirmadas, movimientos, días operativos, cierres,
  reaperturas y cambios de productos.
- Se agregó `GET /api/finanzas/auditoria` y la pantalla administrativa
  `/auditoria`.
- La API de semana expone `fase`: preparación, operación, cierre o cerrada.
- La duración de JWT se redujo de 30 días a 12 horas.

## P2

- Los snapshots usan el último costo histórico disponible anterior al conteo,
  con fallback explícito al costo actual del catálogo.
- Se incorporó telemetría de solicitudes lentas: las rutas API que superan 750
  ms quedan registradas como `[slow-request]` en el servidor.
- La sincronización con Epos conserva su modo de solo lectura: no se inventa una
  escritura hacia Epos sin una API de catálogo autorizada.

## Verificación

- 123 pruebas Vitest correctas.
- TypeScript de cliente correcto.
- Build de cliente y servidor correcto.
- La migración `20261008090000_auditoria_eventos` debe aplicarse antes de usar la
  pantalla de auditoría en producción.
