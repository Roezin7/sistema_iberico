# Cubas y Shot Bacardi — medidas confirmadas

Vigencia: 12 de noviembre de 2026. No se actualizan recetas ni costos de semanas
anteriores y no se reimportan ventas históricas.

| Producto Epos | ID | Receta | Precio leído en Epos |
|---|---:|---|---:|
| Cuba Jim Beam | 4040680 | 60 ml Jim Beam + 200 ml Coca | $85 |
| Cuba de San Matias | 4076091 | 60 ml San Matías + 200 ml Coca | $90 |
| Shot Bacardi | 4055854 | 60 ml Bacardi, sin mezclador | $85 |

El propietario confirmó San Matías de 700 ml. Su inventario permanece en
piezas/fracciones de botella: la cuba consume 60/700 de pieza, no 60 piezas.
Sólo se documenta la capacidad de la capa actual conciliada; no se convierten
los conteos ni lotes antiguos a otra unidad base.

Coca se lleva por pieza y los tickets verifican envases de 450 ml. La nueva
línea conserva **200 ml** como medida de receta y declara explícitamente el
envase de 450 ml: consume 200/450 de pieza. No toma una Coca de 2 L o de tamaño
desconocido como si fuera de 450 ml. Una presentación distinta requiere su
conversión/revisión explícita. El libro guarda fracciones a cuatro decimales,
con la misma precisión del resto de movimientos.

El conversor admite porciones métricas de piezas únicamente con capacidad y
dimensión explícitas de la receta. El catálogo no impone un volumen universal.
La misma conversión se usa al validar, mostrar costos, asignar FIFO y calcular
consumo físico. Los servicios por botella completa siguen contando por pieza.

El costo es proporcional a los lotes elegibles. Los $10 de incremento comercial
no se usan como costo fijo del refresco. Si no hay saldo suficiente, el costo
FIFO completo permanece pendiente: no se genera una compra o existencia para
ocultarlo.

## Aplicación y garantías

`server/scripts/aplicar-cubas-2026-11-12.ts` es sólo lectura sin la variable
explícita `APLICAR_CUBAS_20261112=SI`. Con ella, aplica en una sola transacción
con lock del libro e idempotencia por receta/fuente. Registra auditoría de las
recetas y de la capacidad confirmada de San Matías.

Compara huellas antes/después de snapshots, líneas, cierres, cadena semanal,
ventas, consumos, compras, dinero y cantidades/costos de lotes. Cualquier cambio
inesperado hace rollback. No regulariza por su cuenta la cuenta antigua de
$340 ni reprocesa las excepciones de semanas conciliadas.

## Pruebas

- 320 pruebas automáticas, typecheck y build.
- Prueba PostgreSQL de las tres recetas: dosis/costo por fracción, rechazo de
  Coca de 2 L o desconocida, reintento sin consumos duplicados y apertura intacta.
- Aplicación y segundo intento sobre una copia restaurada de producción:
  mismas recetas, sin duplicación ni cambio de cantidades, dinero o cierres.
