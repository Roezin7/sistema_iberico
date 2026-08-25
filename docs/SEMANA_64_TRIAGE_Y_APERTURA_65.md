# Semana 64 — Triage de incidencias y apertura de la 65

**Fecha de revisión:** 25 de agosto de 2026  
**Regla principal:** la semana 65 se opera sin alterar su apertura. Las correcciones históricas de la 64 se registran por separado y sólo se aplican con evidencia.

## Estado confirmado

- **Semana 64:** cerrada.
- **Semana 65:** abierta, del 17 al 23 de agosto de 2026.
- **Snapshot de apertura:** `59`.
- **Valor de apertura:** **$35,266.06**.
- **Cierre de la 65:** todavía no existe.
- **Conciliación de la 65:** pendiente de cierre.
- **Compras registradas en la 65:** 0 al momento de esta revisión.

El snapshot 59 es el inventario final corregido de la semana 64. No se debe crear otra apertura ni editar este valor durante la prueba.

## Qué reveló la semana 64

La conciliación produjo **78 líneas de diferencia física** (15 productos sin diferencia):

| Clasificación | Líneas | Tratamiento inicial |
|---|---:|---|
| Conversión de presentación | 2 | Confirmar unidad y factor; corregir sólo si la evidencia lo respalda |
| Compra faltante | 19 | Buscar ticket o registrar compra omitida; no inventar lote |
| Receta | 12 | Revisar receta y cantidad vendida; no cambiar receta validada sin evidencia |
| Posible merma | 45 | Mantener como incidencia hasta validar conteo, desperdicio o captura |

La diferencia física neta fue **+$2,544.36** y la diferencia bruta absoluta **$10,694.62**. Esto significa que el resultado no debe interpretarse como una sola “merma”: mezcla presentaciones, compras no cargadas, recetas y posibles pérdidas.

## Cola de resolución priorizada

### P0 — Confirmar conversión antes de tocar cantidades

1. **Papel de baño:** la apertura fue registrada como paquete y el cierre como rollos. Un paquete contiene 3 rollos. Confirmar que ambos conteos se expresen en la misma unidad base.
2. **Toalla interdoblada:** la apertura se capturó como cajas y el cierre como paquetes individuales. Confirmar la presentación real (15 paquetes individuales) y el factor de la caja.
3. **Limón:** el inventario usa piezas y las compras kg. Mantener la conversión documentada de 14 piezas/kg mientras no exista un pesaje real que la sustituya.
4. **Absolut:** validar que la diferencia de 750 ml corresponde a una botella/presentación y no a una salida omitida.
5. **Queso amarillo:** validar la unidad de compra y la unidad base antes de interpretar el faltante como merma.

**Evidencia mínima:** presentación comprada, cantidad física, unidad que se usó en apertura/cierre y, si aplica, fotografía o ticket.

### P1 — Compras o inventario inicial posiblemente omitidos

1. Jamón serrano.
2. Harina.
3. Corona y Modelo.
4. Campari.
5. Papas.
6. Tequila Dobel.

En cada caso se debe buscar primero el ticket de la semana 64 o confirmar que el inventario inicial ya incluía la existencia. Si aparece un ticket, se registra como compra de esa fecha y se crea su lote FIFO; si no aparece, se mantiene como excepción de compra faltante.

### P2 — Receta o consumo teórico

1. Salchichón.
2. Aperol.

Las recetas ya validadas no se vuelven a pedir al usuario. Sólo se revisan las cantidades que consumieron las ventas de la semana y el mapeo del producto Epos.

### P3 — Posible merma o conteo

Pacifico, Nieve, Frutos rojos, Mozzarella, Toalla interdoblada, Tocino y Refresco permanecen como incidencias abiertas. No se deben convertir en gasto ni ajustar inventario hasta contar nuevamente o aportar una explicación verificable.

## Regla de corrección histórica

Una corrección de la semana 64 sólo puede entrar por uno de estos caminos:

1. **Conversión:** ajuste documentado de unidad/presentación, sin crear compra.
2. **Compra faltante:** ticket con fecha y proveedor, que genera lote FIFO en esa fecha.
3. **Receta:** corrección de receta con aprobación y trazabilidad.
4. **Captura:** corrección del snapshot, conservando el anterior en historial.
5. **Merma:** ajuste explícito de salida/merma con motivo y responsable.

Nunca se debe editar silenciosamente el snapshot 59 ni cargar una compra de la 64 dentro de la semana 65.

## Operación de la semana 65

Para cada día funcional:

1. Registrar ventas Epos y separar efectivo, tarjeta, propina y cualquier importe no atribuible.
2. Registrar cada compra del día con ticket, fecha real, proveedor, método de pago y presentación.
3. Confirmar el lote FIFO creado y la unidad base convertida.
4. Registrar gastos y sueldos sólo una vez, en la fecha real del movimiento.
5. Al cierre, contar físicamente usando la unidad que muestra el formulario.
6. Revisar diferencias FIFO vs físico antes de cerrar la semana.

## Criterio para cerrar la semana 65

No se considera lista para cierre hasta que existan:

- inventario inicial proveniente del snapshot 59;
- ventas Epos reconciliadas con pagos diarios;
- compras y tickets de la semana con lotes FIFO;
- gastos sin duplicados;
- inventario físico final con unidades claras;
- conciliación FIFO contra físico;
- clasificación de cada diferencia;
- resultado bruto y operativo separados;
- lista de acciones para las incidencias que sigan abiertas.

## Decisión operativa

La recomendación es **partir del inventario actual y operar la semana 65**, mientras se resuelven las incidencias de la 64 en paralelo. Así obtenemos una segunda semana independiente y podemos distinguir un problema aislado de un patrón repetido, sin perder la trazabilidad del inventario que ya está en producción.
