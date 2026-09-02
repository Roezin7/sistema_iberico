# P0 implementado — flujo operativo integrado

Fecha: 2026-09-01

Este cambio aterriza la primera capa de la reorganización del sistema. La operación sigue teniendo los mismos datos y endpoints; cambia la forma en que se presentan y se capturan para que la semana sea el eje de trabajo.

## Qué cambió

- **Semana actual** es la entrada principal y muestra la fase de la semana: preparación, operación o cierre.
- La navegación principal quedó reducida a **Semana actual**, **Entradas**, **Semana**, **Inventario** y **Checklist**. Las pantallas técnicas quedan en administración.
- **Entradas** es la puerta única para tickets, compras, pendientes y gastos extraordinarios sin ticket. El registro de gasto directo crea sólo el movimiento financiero y no un lote FIFO.
- El **cierre** tiene una guía visible: ventas/pagos → entradas y egresos → conteo físico → arqueo y confirmación.
- El conteo físico de cierre se abre con la semana correcta y regresa al cuadre al guardar.
- Lotes FIFO y reproceso Epos quedan detrás de **Auditoría técnica**, para no sobrecargar la operación diaria.
- Las capturas operativas seguras pueden encolarse sin conexión. Confirmaciones de compras, pagos, cierres y movimientos financieros requieren conexión para proteger la trazabilidad.

## Regla operativa resultante

De lunes a jueves se prepara la semana y se registran compras generales. De viernes a domingo se opera, se captura el corte diario y se prepara el cierre. El inventario físico sigue siendo la fuente de verdad; FIFO se consulta como auditoría de consumo, costo y diferencias.

## Fuera de P0

Quedan para la siguiente fase: creación automática de la semana siguiente al cierre, tablero de decisiones de rentabilidad, consolidación visual de historial de snapshots y pruebas E2E del ciclo completo con una base de datos de prueba.
