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

## Nota sobre ventas y FIFO

La fórmula semanal es el control contable de alto nivel. Cuando la capa FIFO
esté activa para todos los productos, el costo consumido por lote será la fuente
detallada; el ciclo de apertura/cierre seguirá siendo el control de existencia y
la detección de mermas o descuadres.
