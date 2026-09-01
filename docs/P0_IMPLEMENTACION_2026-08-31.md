# P0 — Confiabilidad del cierre semanal

**Estado:** implementado, publicado y ejecutado en producción sobre la semana 65.

## Cambios aplicados

- La conciliación FIFO contra inventario físico se puede recalcular y guardar
  por semana mediante una operación idempotente.
- Las filas guardadas comparan explícitamente apertura, compras, consumo FIFO,
  existencia FIFO esperada y conteo físico final.
- La diferencia persistida es la diferencia FIFO–físico; el residuo de los
  movimientos, la apertura y la clasificación se conservan en `notas` para no
  mezclar merma con conversiones o diferencias históricas.
- Se añadieron rutas de consulta y recálculo:
  - `GET /finanzas/semanas/:id/conciliacion-inventario`
  - `POST /finanzas/semanas/:id/conciliacion-inventario/recalcular`
- El cierre reutiliza el snapshot oficial de tipo `cierre` ya capturado. No
  crea una segunda fotografía cuando el conteo ya existe.
- Si hay un snapshot de cierre de la semana aún no vinculado al ciclo semanal,
  el cierre completa ese vínculo y usa su valuación física.
- Ventas Epos en estado `pendiente` o `excepcion` bloquean el cierre. Ya no
  existe un botón que permita convertir accidentalmente ese resultado
  provisional en una semana cerrada.
- Al reabrir una semana se eliminan las filas de conciliación de esa versión
  del cierre; se regeneran al volver a cerrar o recalcular.
- La tabla `inventory_fifo_reconciliations` quedó declarada en Prisma y tiene
  una migración idempotente compatible con bases donde ya existía.
- La cola de ventas sin costo ahora se agrupa por producto y causa raíz
  (`mapeo`, `receta/unidad`, `inventario` o `captura`), acumulando líneas,
  unidades e importe. El resumen muestra la acción concreta que debe tomar el
  operador y evita repetir la misma excepción por cada ticket.
- Se añadió `GET /finanzas/semanas/:id/excepciones-costeo` para que la cola
  pueda consumirse desde una pantalla de incidencias sin duplicar consultas ni
  mezclarla con el historial de reversiones.

## Criterio operativo

La conciliación no convierte automáticamente una diferencia en merma. Cada
producto conserva su clasificación como conversión, compra faltante, receta,
captura, posible merma o sin diferencia. Sólo el residuo que permanezca después
de resolver las primeras cuatro categorías puede considerarse posible merma.

## Validación local

- `npm run build`: cliente y servidor compilados correctamente.
- `npm test`: 112 pruebas aprobadas.
- `prisma validate`: esquema válido.

## Resultado de la ejecución en producción

- Migración aplicada correctamente en PostgreSQL productivo.
- Conciliación de la semana 65 guardada de forma idempotente: 95 productos,
  86 con incidencia, diferencia residual de `-$3,514.49` y reporte todavía no
  independiente.
- No se alteraron ventas ni snapshots: permanecen 104 ventas y un snapshot de
  cierre; tras recostear Agua mineral y Cuba de Ron hay 366 consumos FIFO
  activos (`$3,128.06`).
- Se validaron las recetas operativas de **Agua mineral** (400 ml por unidad)
  y **Cuba de Ron** (60 ml de Bacardi + 1 pieza de Coca de 250 ml). Las ventas
  se recostearon en FIFO usando sus lotes activos.
- Las tres ventas de Agua mineral quedaron en $5.40 cada una, sin consumir una
  botella completa; la venta de Cuba de Ron quedó en $65.40.
- Después de reprocesar, la cola accionable quedó en tres grupos: Ronchata por
  inventario insuficiente, Clericot grande por ingredientes sin catálogo y
  Tabla de Tapas Mixtas sin receta vinculada.

## Siguiente acción de operación

Resolver esos tres grupos con evidencia (receta validada, alta de producto o
lote recibido),
reprocesar el costeo y volver a recalcular la conciliación. El cierre seguirá
bloqueado mientras exista una venta pendiente o una excepción real.
