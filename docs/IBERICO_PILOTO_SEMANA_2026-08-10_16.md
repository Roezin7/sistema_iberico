# Piloto histórico Ibérico — Semana 10–16 de agosto de 2026

## Estado

- Semana operativa: `Semana 2026-08-10` (ID 63), cerrada al revisar el 21 de agosto.
- Inventario inicial: snapshot 49, capturado el 10 de agosto.
- Ventas Epos Now: $9,786.00, 126 unidades, 30 transacciones.
- Conciliación Epos: confirmada para el 14, 15 y 16 de agosto.
- No existe todavía un conteo físico final de la semana; por ello el resultado es una reconstrucción histórica y no un cierre definitivo de merma.

## Ventas conciliadas

| Fecha | Transacciones | Unidades | Venta | Efectivo | Tarjeta |
|---|---:|---:|---:|---:|---:|
| 2026-08-14 | 11 | 54 | $4,146.00 | $3,606.00 | $540.00 |
| 2026-08-15 | 12 | 53 | $4,320.00 | $1,390.00 | $2,930.00 |
| 2026-08-16 | 7 | 19 | $1,320.00 | $1,320.00 | $0.00 |
| **Total** | **30** | **126** | **$9,786.00** | **$6,316.00** | **$3,470.00** |

Las propinas con tarjeta ($48.00 el 14 de agosto) permanecen como movimiento separado, conforme a la operación real.

## Compras

Los cuatro tickets ya estaban registrados financieramente en la Semana 63. No se duplicaron. El total que permanece en los movimientos de compras y gastos es **$7,925.70**:

- Bodegas Alameda: $2,922.00.
- Costco: $3,320.00.
- La Comer 1: $1,546.50.
- La Comer 2: $137.20.

La revisión de la base actual confirma que esos cuatro tickets no están persistidos como
registros detallados de `purchases/purchase_lines`; sólo existen los movimientos
financieros. Por tanto, los costos observados del 11 de agosto todavía no están
aplicados como lotes FIFO de compra. Véase
`docs/IBERICO_WEEK63_RECONCILIACION_TICKETS_2026-08-21.md`.

## Gastos y sueldos ya existentes

- Gastos de operación registrados: $2,442.00, incluyendo impuestos y gastos diarios.
- Sueldos registrados: $3,790.00.
- No se agregaron gastos diarios duplicados.

## Incidencias abiertas

1. **Resuelta:** las cuatro compras financieras están fechadas el 11 de agosto y asociadas a la Semana 63. Los importes permanecen iguales y no deben duplicarse.
2. Falta reconstruir el detalle idempotente de esas compras y crear sus lotes FIFO históricos; todavía no se debe presentar el margen como FIFO real por compra.
3. La compra de arúgula está identificada en el ticket, pero la presentación exacta y su rendimiento útil siguen pendientes para consumirla correctamente en recetas.
4. No existe un conteo físico final de la semana. La merma real no puede cerrarse hasta compararlo contra el inventario calculado.
5. La tabla actual de compras no conserva por sí sola el importe por línea; el detalle deberá reconstruirse desde los tickets ya documentados.

## FIFO del piloto

El registro persistente actual del piloto conserva la apertura histórica y los
ajustes explícitos. La base revisada no contiene todavía lotes de las compras del
11 de agosto. El costeo vigente es provisional: 55 ventas costeadas, 33
excepciones y $1,861.4069 de costo FIFO. No debe confundirse con el resultado
final por compra.

El cálculo dejó 13 faltantes explícitos, no valores inventados:

- Agua natural: 2,200 ml.
- Carnation: 236.60 ml.
- Concentrado de horchata: 118.28 ml.
- Fresas: 80 g.
- Lechera: 118.28 ml.
- Limón: 69 piezas.
- Michemix: 120 ml.
- Mozzarella: 520 g.
- Pepino: 120 g.
- Perejil: 2 piezas.
- Piña: 300 g.
- Saborizante de tamarindo: 88.71 ml.
- Viuda de Sánchez: 29.57 ml.

Para este primer ejercicio, esos 13 faltantes se regularizaron como inventario inicial no contabilizado y quedaron consumidos en FIFO; el piloto termina con **cero faltantes técnicos**. Estos ajustes no modifican el conteo físico real ni sustituyen el control futuro por foto de ticket.

## Siguiente paso

Comparar el inventario FIFO calculado contra un conteo físico final y resolver los 13 faltantes. Hasta entonces, cualquier margen calculado debe etiquetarse como **reconstrucción piloto**, no como cierre contable definitivo.
