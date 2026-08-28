# Estado de implementación · 27 de agosto de 2026

## Decisión operativa

Ibérico trabaja con un libro FIFO continuo. Los lotes no se reinician al cambiar
de semana: una compra crea un lote con su fecha y costo, y cada venta consume
los lotes abiertos en orden de recepción. Una reversión permanece en historial
y no vuelve a entrar en el costo activo.

## Cambios aplicados

- Se centralizó la definición de `consumo FIFO activo` en
  `server/src/inventario/fuentes.ts`.
- Esa regla se usa en costeo Epos, valuación al corte, conciliación de
  inventario, existencia FIFO esperada, costo de ventas y reportes mensuales.
- `venta_receta_historica` se considera consumo activo; las fuentes que empiezan
  por `reversion_` quedan fuera del costo y sólo se conservan como auditoría.
- El costeo confirmado bloquea las ventas Epos durante la transacción y vuelve a
  comprobar el ledger antes de insertar consumos. Repetir una sincronización no
  duplica consumo ni reduce dos veces un lote.
- El cierre toma exclusivamente el snapshot de cierre asociado a la semana. Si
  todavía no existe, bloquea el cierre y solicita capturarlo; nunca usa el
  último snapshot global ni uno de otra semana.
- Las consultas de inventario, movimientos, arqueos, compras y conciliaciones
  incluyen `negocio_id` junto con `semana_id`.
- La respuesta financiera separa flujo de caja, utilidad bruta, resultado
  operativo, activos, pasivos y patrimonio neto. Las propinas quedan fuera del
  ingreso operativo.
- El mapeo Epos se aplica por ID y, sólo como respaldo determinista, por nombre;
  los conflictos de ID no se reasignan automáticamente.

## Regla de lectura de resultados

`costo_ventas` sólo tiene valor cuando existe consumo FIFO activo. La diferencia
entre apertura + compras − cierre se muestra en conciliación como control físico,
pero no se usa para fabricar un costo contable cuando el ledger está incompleto.
El P&L mensual identifica explícitamente el método `fifo` cuando existe ledger.

## Validación realizada

- TypeScript de servidor y cliente: correcto.
- Prisma schema: formato correcto.
- Suite Vitest: 106 pruebas correctas.
- Build de cliente y servidor: correcto con el entorno de build autorizado.
- Pruebas nuevas: reversiones, duplicados, semanas consecutivas y zonas
  horarias; además de prioridad del costo FIFO en el P&L.
- Navegación local: rutas principales cargan sin errores de JavaScript.

## Respaldo y auditoría productiva

El script `scripts/backup-restore-check.sh` genera un dump custom, valida su
contenido y, sólo con `ALLOW_RESTORE=YES` y una URL de restauración distinta,
ejecuta una restauración destructiva explícita. La auditoría SQL está en
`scripts/auditar-produccion-readonly.sql`.

Se generó un dump custom de producción mediante la URL pública configurada, sin
ejecutar escrituras, y se validó su restauración en una instancia PostgreSQL 18
aislada. El archivo quedó fuera del repositorio para no incluir datos operativos
en el código. Evidencia del artefacto: 4.0 MB, SHA-256
`30415cdecad05f96dce41b3195e7f91098d6756da6f9f521c53f566e85161a2b`; la
restauración aislada devolvió 1 negocio, 227 ventas Epos y 220 lotes FIFO.

La misma comprobación con `DATABASE_READONLY_URL` no puede ejecutarse desde este
equipo porque el hostname interno sólo resuelve dentro de Coolify. El script
queda preparado para ejecutarse desde el terminal del servicio y conservar la
misma evidencia allí.

La auditoría de producción en modo transacción de sólo lectura confirmó: un
negocio, 58 semanas, 227 ventas Epos costeadas, 220 lotes FIFO, cero huérfanos,
cero claves de consumo duplicadas y cero snapshots semanales duplicados. Las
39 denominaciones vendidas en el periodo consultado tienen coincidencia
determinística con el menú y receta validada; 104 líneas antiguas no traen
`epos_product_id` en el payload de Epos, pero se resuelven por nombre sin crear
una excepción de costo. El sistema deja esos IDs externos visibles para
completarlos si Epos los entrega en una futura sincronización.

## Pendientes reales

1. Ejecutar también el script desde Coolify para conservar el respaldo en el
   mismo entorno de despliegue.
2. Completar manualmente sólo los productos Epos que permanezcan en
   `sin_mapeo`; no inventar recetas para resolver excepciones.
3. Mantener la operación en modo vista previa hasta que la diferencia entre
   ventas Epos y pagos diarios esté documentada y aprobada.
