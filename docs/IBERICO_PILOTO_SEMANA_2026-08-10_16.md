# Piloto histórico Ibérico — Semana 10–16 de agosto de 2026

## Estado

- Semana operativa: `Semana 2026-08-10` (ID 63), abierta.
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

Los cuatro tickets ya estaban registrados financieramente en la Semana 63. No se duplicaron. El total de compras de inventario que permanece en el sistema es **$7,925.70**:

- Bodegas Alameda: $2,922.00.
- Costco: $3,320.00.
- La Comer 1: $1,546.50.
- La Comer 2: $137.20.

Además, quedaron persistidas cuatro compras detalladas con 25 líneas y 55 presentaciones para asociar productos, cantidades y costos históricos. Los costos observados del 11 de agosto se guardaron sin sobrescribir el costo actual del catálogo.

## Gastos y sueldos ya existentes

- Gastos de operación registrados: $2,442.00, incluyendo impuestos y gastos diarios.
- Sueldos registrados: $3,790.00.
- No se agregaron gastos diarios duplicados.

## Incidencias abiertas

1. **Resuelta:** las cuatro compras financieras se corrigieron al 11 de agosto, fecha de los tickets. Los importes y la asociación a la Semana 63 permanecen iguales.
2. La compra de arúgula está registrada, pero la presentación exacta y su rendimiento útil siguen pendientes para consumirla correctamente en recetas.
3. No existe un conteo físico final de la semana. La merma real no puede cerrarse hasta compararlo contra el inventario calculado.
4. La tabla actual de compras no conserva por sí sola el importe por línea. Los costos históricos y las líneas detalladas se conservaron como puente para la implementación FIFO.

## FIFO del piloto

Se creó el registro persistente del piloto con 130 lotes: 93 lotes derivados del inventario inicial, 24 lotes de compras del 11 de agosto y 13 lotes de ajuste inicial autorizados para representar existencias que ya estaban físicamente pero no habían sido contabilizadas. El consumo de las recetas de las 126 unidades vendidas produjo un costo FIFO provisional de **$3,509.24**.

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
