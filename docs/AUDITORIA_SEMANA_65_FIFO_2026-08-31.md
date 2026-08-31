# Auditoría de semana 65 — FIFO contra inventario físico

**Fecha de revisión:** 31 de agosto de 2026  
**Periodo operativo:** 24–30 de agosto de 2026  
**Base:** datos productivos consultados en modo de lectura y cálculo vigente de la aplicación.

## Conclusión ejecutiva

El consumo FIFO activo sí está calculándose y coincide con el costo de las
ventas Epos que ya tienen receta. Sin embargo, la semana todavía **no es un
resultado independiente ni está lista para cerrarse**: existen ocho líneas Epos
sin costo confirmado y permanece una diferencia histórica en la apertura.

Las diferencias físicas no deben llamarse merma todavía. El residuo semanal
mezcla errores de captura, presentaciones, compras omitidas y recetas; sólo lo
que sobreviva a esas revisiones podrá clasificarse como posible merma.

## Cifras de la semana

| Concepto | Resultado |
|---|---:|
| Ventas Epos | **$8,110.00** |
| Efectivo | $5,550.00 |
| Tarjeta | $2,560.00 |
| Compras de inventario | **$3,981.00** |
| Consumo FIFO activo | **$3,046.46** |
| Ventas con costo FIFO activo | 96 líneas |
| Líneas Epos pendientes o con excepción | 8 |
| Importe Epos pendiente o con excepción | **$610.00** |
| Utilidad bruta provisional | **$5,063.54** |
| Resultado operativo provisional | **$1,580.60** |
| Inventario físico de apertura almacenado | $35,266.06 |
| Inventario físico de cierre almacenado | $35,237.42 |
| Residuo semanal valorizado | **-$3,594.73** |
| Diferencia histórica de apertura | **-$1,695.82** |

Las compras confirmadas suman $3,993.00; $3,981.00 son inventario y $12.00
corresponden a gasto operativo del ticket, por lo que no entran a los lotes.

La utilidad y el resultado operativo son provisionales porque el reporte aún no
puede considerarse independiente.

## Validación del flujo FIFO

La fuente única del costo de ventas es el consumo FIFO activo (`venta_receta`).
Las reversiones se conservan como historial/auditoría y no se suman al costo
activo. En la revisión se observaron:

- 361 movimientos de consumo FIFO activos;
- $3,046.46 de costo activo;
- $0.00 de costo activo clasificado como excepción;
- 133 filas de reversión histórica, excluidas del costo;
- diferencia de costo contra las ventas Epos costeadas: **$0.00**.

Esto confirma que el cálculo de costo para las 96 líneas costeadas es
consistente. No confirma todavía que todo el inventario físico esté explicado.

## Excepciones Epos que siguen abiertas

Las cinco asociaciones Epos existen en el catálogo. Las ocho líneas pendientes
corresponden a cinco productos vendidos, no a productos sin mapeo:

| Producto | Líneas | Venta | Motivo |
|---|---:|---:|---|
| Agua mineral | 3 | $75.00 | Falta receta operativa aprobada |
| Tabla de Tapas Mixtas | 1 | $165.00 | Selección variable de tres montados; falta modelo verificable |
| Cuba de Ron | 1 | $70.00 | Falta receta operativa aprobada |
| Clericot grande | 1 | $130.00 | Falta receta operativa aprobada |
| Ronchata | 2 | $170.00 | Faltan 29.57 ml de concentrado de horchata |

No se deben inventar las cuatro recetas faltantes. Ronchata sí tiene receta
validada; su excepción es de inventario y debe resolverse con una compra,
conversión o conteo respaldado.

## Conciliación que debe gobernar el cierre

Para cada producto, el sistema calcula ahora:

```text
Inventario físico inicial
+ compras recibidas
+ ajustes de inventario aprobados
- consumo FIFO activo
= existencia esperada por movimientos

Inventario físico final
- existencia esperada por movimientos
= diferencia residual de la semana
```

La diferencia contra el libro FIFO restante se muestra por separado. No se usa
como merma porque puede contener una diferencia de apertura o una conversión de
presentación.

La conciliación contiene 95 productos: 85 con alguna diferencia y 10 sin
diferencia. La clasificación actual es:

| Tipo | Productos | Lectura |
|---|---:|---|
| Captura / apertura histórica | 78 | Debe resolverse comparando snapshots y presentaciones |
| Posible merma | 4 | Recontar y documentar antes de ajustar |
| Compra faltante | 2 | Buscar ticket y fecha real |
| Receta | 1 | Revisar cantidad o receta validada |
| Sin diferencia | 10 | No requiere ajuste |

La mayor parte del importe no es una pérdida semanal nueva: está dominada por
la diferencia de apertura. Entre los residuos más grandes aparecen Mermelada
(-$561.71), Pacífico (+$521.62), Modelo (-$456.00), Victoria (+$418.00), Papas
a la francesa (-$404.05), Tequila Dobel (-$397.74), 1800 Cristalino (-$373.69),
Corona (-$304.00), Campari (-$290.02), Salchichón (-$247.84) y Frutos rojos
(-$231.55). Son prioridades de conteo/presentación; no deben registrarse como
merma sin evidencia.

## Qué explica la diferencia actual

### 1. Diferencia histórica de apertura

La apertura proviene del snapshot anterior y conserva una diferencia histórica
reportada de **-$1,695.82** contra los lotes FIFO de apertura. Además, el valor
guardado en el snapshot ($35,266.06) y la valuación recalculada por lotes no son
la misma magnitud contable: la primera es la valuación capturada al cierre y la
segunda depende de los costos FIFO vigentes. Esto debe mantenerse separado; no
debe cargarse a la semana 65 como compra ni como merma.

### 2. Presentaciones y conversiones

El detalle por producto ya muestra presentación de apertura y cierre, unidad
base, factor y residuo. Los casos conocidos de mayor impacto son papas (bolsa),
jamón serrano (packs con distintos pesos históricos), limón (kg a piezas) y
productos de bebida comprados por botella. Deben compararse en la misma unidad
base antes de ajustar existencias.

### 3. Compras o capturas faltantes

Los residuos grandes de papas, quesos, embutidos, tequila, Campari, cerveza y
frutos rojos no prueban merma. Primero hay que comprobar ticket, fecha real,
presentación y conteo de apertura/cierre. Un ticket faltante se registra en su
fecha real y crea su lote; no se corrige editando silenciosamente el snapshot.

### 4. Recetas pendientes

Los $610.00 de Epos sin costo no deben entrar a la utilidad real. Al aprobar las
recetas con evidencia, se reprocesarán de forma idempotente y se actualizará el
costo del menú.

## Estado operativo

- Semana 65: **abierta**.
- Snapshot de apertura: 59.
- Snapshot de cierre: 60, ya enlazado; no se debe crear otro.
- Costo FIFO activo: operativo para ventas costeadas.
- Conciliación física: calculada, pero **no independiente**.
- Reversiones: sólo historial.
- Cinco productos Epos: mapeados; cuatro requieren receta y uno inventario.

## Orden recomendado de resolución

1. Confirmar las presentaciones físicas de los productos con mayor residuo.
2. Buscar y registrar tickets omitidos con su fecha real, sin duplicarlos.
3. Resolver el concentrado de horchata de Ronchata.
4. Documentar y aprobar Agua mineral, Cuba de Ron, Clericot y Tabla de Tapas.
5. Recalcular FIFO activo y la conciliación después de cada corrección.
6. Revisar que el residuo restante sea únicamente físico y explicar cada línea.
7. Sólo entonces calcular utilidad bruta/operativa como resultado verificado y
   decidir si existe merma.

## Criterio de cierre

La semana 65 sólo debe cerrarse cuando:

- las ventas Epos y pagos diarios coincidan;
- no haya líneas Epos pendientes o con excepción no explicada;
- la apertura esté documentada como histórica o convertida, nunca mezclada;
- compras, ajustes y consumo FIFO activo estén completos;
- exista un único conteo físico de cierre;
- cada diferencia residual tenga clasificación y responsable;
- utilidad bruta, resultado operativo y patrimonio se presenten como cifras
  independientes.
