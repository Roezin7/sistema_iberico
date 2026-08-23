# Ciclo semanal de inventario

## Regla oficial

Cada semana debe tener una apertura y un cierre de inventario separados del
conteo operativo actual:

```text
Inventario de apertura
+ Compras y entradas de la semana
- Inventario físico de cierre
= Costo consumido de la semana
```

El cierre físico de una semana se convierte en la apertura de la siguiente.
No se debe volver a tomar el último conteo global como apertura si ya existe un
cierre semanal enlazado.

## Qué cambió

Antes, `inventory_snapshot` era un historial de conteos sin relación con
`semanas`. El cierre financiero leía el inventario global más reciente, aunque
ese conteo pudiera pertenecer a otro periodo.

Ahora `inventario_semanal` conserva, para cada semana:

- snapshot de apertura;
- valor de apertura congelado;
- snapshot de cierre;
- valor de cierre congelado;
- origen de la apertura (`cierre_semana_anterior` o
  `conteo_historico_bootstrap`).

Los snapshots originales no se modifican. En la migración, las semanas
históricas reciben como apertura el último conteo disponible; no se inventan
cierres históricos.

## Flujo operativo

1. Abrir una semana: el sistema enlaza el cierre de la semana anterior.
2. Registrar compras, ventas y gastos normalmente.
3. Capturar el conteo físico final.
4. Cerrar la semana: el sistema congela un snapshot consolidado de todas las
   zonas y calcula `apertura + compras - cierre`.
5. Crear la siguiente semana: su apertura es exactamente ese cierre.

Mientras una semana no tenga conteo de cierre, el resumen muestra
`pendiente_cierre` y no calcula un costo de ventas defendible.

## Nota sobre ventas y FIFO en vivo

El libro FIFO es continuo y no se reinicia al cambiar de semana. Una compra
confirmada agrega un lote con su fecha y costo; una venta Epos sincronizada
consume inmediatamente los lotes disponibles en orden de recepción. Los lotes
restantes pasan a las semanas siguientes sin copiarse ni volver a valuarse como
una compra nueva.

La fórmula semanal queda como control de alto nivel y puente contable. El costo
de ventas detallado proviene del ledger de consumos FIFO del periodo. El cierre
físico se compara contra la existencia FIFO esperada para identificar merma,
error de captura, receta incorrecta o compra faltante.
