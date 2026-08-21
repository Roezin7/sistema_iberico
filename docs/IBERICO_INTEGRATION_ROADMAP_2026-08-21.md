# Integraciones pendientes — Ibérico

## Ya disponible

### Epos Now en modo lectura

- Estado y conexión configurados.
- Vista previa de conciliación.
- Sincronización idempotente de ventas.
- Desglose por producto, día y método de pago.
- Importación persistida sin modificar inventario automáticamente.

Se corrigió el adaptador para aceptar `ProductID` y `ProductId`, y `Discount` y
`DiscountValue`. El formato real de Epos usaba la segunda variante; antes las
ventas quedaban sin ID estable aunque se resolvieran por nombre.

### Compras y tickets

- Captura móvil con foto.
- Detección de ticket duplicado.
- Revisión de líneas.
- Clasificación inventario/gasto/pendiente.
- Origen de pago.
- Aprobación que crea lote FIFO y movimiento.

### FIFO y recetas

- Lotes por compra.
- Consumo FIFO por receta validada.
- Libro de consumos.
- Idempotencia por venta.
- Excepciones por faltante, receta o mapeo.

## Falta para una operación integrada

### Prioridad 1 — cerrar la semana 64 sin datos manuales duplicados

- Sincronización diaria desde Epos.
- Conciliación diaria de efectivo, tarjeta, otros y cuentas abiertas.
- Compra móvil completa con suma de líneas igual al ticket.
- Resolución de las siete excepciones actuales.

### Prioridad 2 — catálogo estable Epos → menú

Las 36 referencias vendidas de la semana 63 coinciden hoy por nombre con el
menú, pero las filas históricas tenían `epos_product_id` nulo debido a la
variante de campo del reporte. El adaptador ya está corregido para futuras
importaciones. Antes de usar margen automatizado como dato oficial, hay que:

1. volver a importar un periodo de prueba con el adaptador corregido;
2. revisar los IDs contra los 59 productos activos del menú;
3. aprobar las asociaciones sin colisiones;
4. mantener el nombre sólo como respaldo auditado.

### Prioridad 3 — rentabilidad real

Falta combinar en un cierre único:

- ventas netas Epos;
- costo FIFO de recetas;
- compras inventariables;
- gastos no inventariables;
- sueldos;
- comisiones y propinas;
- merma;
- inventario inicial y final.

Hasta completar esos ocho componentes, “margen” significa margen bruto de
producto, no utilidad operativa.

### Prioridad 4 — automatización controlada

Después de demostrar tres días seguidos sin duplicados:

- programar sincronización diaria;
- generar alerta de corte pendiente;
- generar cola visual de excepciones;
- impedir cierre con excepciones críticas sin decisión humana;
- conservar una acción de reintento idempotente.

### Prioridad 5 — captura para empleados

Cuando el flujo del fundador sea estable:

- roles limitados para captura de tickets;
- aprobación administrativa separada;
- fotos privadas en almacenamiento de objetos;
- historial de quién capturó y quién aprobó;
- soporte de compras pagadas en banco o caja.

### Prioridad 6 — integración completa de costos

- completar presentaciones y rendimientos de insumos;
- separar recetas vigentes de precios objetivo de la reingeniería de menú;
- conservar recetas versionadas por fecha;
- registrar lotes de producción interna como mermelada, guacamole y otros
  preparados;
- incorporar gastos fijos y variables para utilidad operativa.

## Criterio para declarar Fase 1

Ibérico puede pasar a Fase 1 cuando complete dos semanas reales consecutivas
con:

- ventas Epos sincronizadas sin duplicados;
- pagos confirmados por día;
- tickets con líneas y presentación;
- FIFO costeable para todos los productos vendidos o excepciones aceptadas;
- inventario de cierre encadenado a la apertura siguiente;
- gastos y sueldos sin duplicidad;
- informe de margen bruto y utilidad operativa separado;
- lista de incidencias convertida en mejoras justificadas por repetición.
