# Operating Brief — Ibérico

Fecha: 21 de agosto de 2026  
Semana activa: 64 · 17–23 de agosto de 2026  
Semana histórica de prueba: 63 · 10–16 de agosto de 2026

## Estado ejecutivo

Ibérico está en **Fase 0: control operativo y validación de datos**. El sistema
ya tiene la cadena principal, pero esta semana debe demostrarla con operación
real: venta Epos → conciliación diaria → compra con evidencia → lote FIFO →
merma/conteo → cierre semanal.

La semana 63 ya funciona como laboratorio histórico. La semana 64 es la primera
semana que no debe contaminarse con ajustes históricos ni con cifras inventadas.

## Qué demostró la semana 63

- 104 líneas y 126 unidades de venta fueron importadas desde Epos.
- Ventas Bookkeeping: **$9,786.00**.
- 88 ventas quedaron costeadas con FIFO.
- Costo FIFO: **$3,190.1892**.
- Excepciones finales: **0**.
- Se conservaron compras y gastos por **$7,925.70** sin duplicar movimientos.
- La prueba necesitó regularizaciones explícitas porque el inventario inicial no
  estaba completamente representado.

Conclusión: el motor FIFO y las recetas funcionan; lo que falta probar es el
flujo repetible de captura diaria con datos vivos y sin regularizaciones.

## Estado de la semana 64

| Elemento | Estado actual |
|---|---|
| Semana | Abierta, 17–23 agosto |
| Inventario de apertura | Snapshot 52, valor $39,202.63 |
| Lotes de apertura | 79 lotes, 423 unidades agregadas |
| Conciliaciones diarias | Aún no confirmadas |
| Ventas Epos existentes | 16 filas de prueba; $1,230.00 |
| Ventas costeadas | 9 |
| Excepciones actuales | 7: hierbabuena, romero y mozzarella |
| Compras con ticket móvil | Bodegas Alianza y La Comer confirmadas; compra local pendiente |
| Cierre semanal | No iniciado |

Las 16 ventas existentes son datos de prueba ya presentes en la semana 64. No
se borran ni se vuelven a importar; deben tratarse como el primer lote de
evidencia de la semana y quedar claramente separadas de las ventas reales que
se sincronicen después.

## Objetivo de esta semana

Completar una semana operativa trazable, aunque todavía sea asistida:

1. registrar cada día de venta desde Epos;
2. confirmar efectivo, tarjeta, otros y cuentas abiertas;
3. capturar todas las compras mediante ticket;
4. confirmar líneas y origen de pago antes de crear lotes;
5. costear sólo recetas verificadas;
6. registrar merma y faltantes como excepciones explícitas;
7. cerrar con inventario físico y encadenarlo a la semana 65.

## Qué hacer hoy

### Apertura

- No crear otro snapshot de apertura.
- Verificar que la semana activa sea la 64 y que use el snapshot 52.
- No tocar la semana 63 ni los lotes `historico_prueba`.

### Durante la operación

- Capturar cada ticket con foto, proveedor, fecha, líneas, presentación y
  origen de pago.
- Si una línea no se reconoce, dejarla `pendiente`; no convertirla en gasto o
  inventario por intuición.
- No cargar el mismo ticket dos veces: usar el `ticket_ref` o la foto original.

### Al terminar el día

- Ejecutar la sincronización Epos del día una sola vez.
- Revisar ventas por producto y método de pago.
- Registrar cuentas abiertas y su causa.
- Confirmar el corte diario sólo cuando Epos y la revisión humana coincidan.
- Revisar excepciones FIFO. No hacer ajustes históricos en la semana activa.

## Cadencia diaria

```text
Venta en Epos
  → sincronización del día
  → revisión de productos y pagos
  → conciliación diaria confirmada
  → consumo FIFO de recetas validadas
  → excepciones visibles
```

## Cadencia de compras

```text
Foto del ticket
  → lectura y revisión de líneas
  → producto interno + presentación + unidad base
  → inventario / gasto / pendiente
  → origen de pago
  → aprobación
  → lote FIFO y movimiento financiero
```

## Regla de decisión

Esta semana no se deben crear nuevos ajustes de inventario para que el margen
“salga”. Si falta algo:

- primero verificar ticket y presentación;
- después revisar conversión y receta;
- después contar físicamente;
- sólo entonces registrar merma o diferencia con razón explícita.

## Criterio de cierre de la semana 64

La semana puede cerrarse cuando existan:

- conciliación confirmada por cada día con ventas;
- cero importaciones Epos duplicadas;
- compras con ticket o excepción documentada;
- productos vendidos mapeados a menú y receta, o excepción aceptada;
- costo FIFO y faltantes visibles por producto;
- gastos y sueldos registrados sin duplicidad;
- conteo físico final;
- diferencias clasificadas como merma, receta, rendimiento, compra faltante o
  error de captura;
- snapshot final que se convierta en apertura de la semana 65.

## Qué debe moldear las siguientes semanas

- Si los mismos faltantes aparecen dos semanas seguidas, corregir presentación
  o rendimiento del catálogo.
- Si se repiten compras sin líneas completas, mejorar la captura móvil antes de
  ampliar automatización.
- Si Epos mantiene nombres estables pero IDs ausentes, usar el nombre sólo como
  respaldo y completar la asociación estable antes de calcular margen
  definitivo.
- Si la conciliación diaria coincide tres días consecutivos, automatizar el
  corte programado; antes no.
