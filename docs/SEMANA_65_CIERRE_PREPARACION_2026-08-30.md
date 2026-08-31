# Semana 65 — preparación de cierre (24–30 agosto 2026)

Documento operativo generado el 30 de agosto de 2026. La semana permanece
abierta hasta registrar el conteo físico real del domingo.

## Correcciones aplicadas

- Se reclasificaron **$300.00** que habían quedado en el sábado. El sábado
  queda con Epos de **$4,255.00** (efectivo $2,585.00, tarjeta $1,670.00).
- El domingo queda registrado en revisión con **$300.00 en tarjeta**. No se
  confirmó manualmente el corte porque falta el cierre de caja.
- Se asociaron al catálogo Epos cinco productos vendidos sin asociación:
  Agua mineral, Clericot grande, Cuba de Ron, Montado Sevillano (Quesos y
  Serrano) y Tabla de Tapas Mixtas. Se dejaron sin receta nueva para no
  inventar cantidades; hasta documentarlas deben aparecer como pendientes de
  receta, no como costo confirmado.
- Se cerró como agotado el lote de Squirt con saldo cero que permanecía abierto.
  El faltante actual de Squirt sigue siendo **830 ml** y requiere revisar una
  compra o una conversión; no se creó existencia artificial.
- Se corrigió la fecha civil de los **299 consumos FIFO** de la semana 65 para
  usar la fecha de operación de México, sin cambiar cantidades ni costos.
- La apertura de la semana conserva el valor físico **$35,266.06** y ahora
  documenta el puente FIFO inicial pendiente de **$4,652.89**.

## Estado calculable antes del conteo dominical

| Concepto | Valor |
|---|---:|
| Ventas Epos hasta sábado | $6,640.00 |
| Venta Epos domingo registrada | $300.00 |
| Ventas Epos semana completa conocida | $6,940.00 |
| Transacciones / unidades Epos | 29 / 101 |
| Costo FIFO activo semana (incluye venta dominical) | $2,498.54 |
| Compras de inventario de la semana | $3,939.00 |
| Gastos operativos incluidos en tickets | $12.00 |
| Apertura física oficial | $35,266.06 |
| Puente FIFO inicial pendiente | $4,652.89 |
| Ventas costeadas | $6,040.00 |
| Ventas pendientes de receta | $550.00 |
| Ventas con excepción real Squirt | $350.00 |
| Faltante de Squirt | 830 ml |

El desglose Epos de la semana es **$4,380.00 en efectivo** y **$2,560.00 en
tarjeta**. Las compras registradas suman **$3,951.00** en flujo de salida; de
ese importe, **$3,939.00** corresponde a líneas de inventario FIFO y **$12.00**
a un gasto operativo del ticket de frutería. No se debe sumar ese gasto a los
lotes.

Las únicas ventas que todavía no entran al costo son:

- **$350.00** por faltante real de Squirt (830 ml acumulados).
- **$550.00** por cinco productos catalogados sin receta documentada.

No se corrigieron con existencias ficticias. El primer grupo requiere validar la
compra/conversión de Squirt; el segundo requiere completar y aprobar las recetas.

La distribución por fecha civil (zona operativa de México) es:

| Fecha | Ventas | Transacciones | Unidades |
|---|---:|---:|---:|
| Viernes 28-08 | $2,385.00 | 14 | 35 |
| Sábado 29-08 | $4,255.00 | 14 | 63 |
| Domingo 30-08 | $300.00 | 1 | 3 |

Esto confirma que los **$300.00** pertenecen al domingo; la API los entrega en
UTC dentro de la importación del sábado, pero el sistema ya los guarda con fecha
civil local para consumo y conciliación.

La venta dominical de CBA Doble D ya quedó costeada de forma idempotente. La
utilidad real de la semana no debe confirmarse hasta que se capture el inventario
físico final. Las cinco nuevas asociaciones ya están en catálogo, pero sus
ventas permanecen pendientes mientras no exista una receta validada.

## Cierre dominical pendiente

1. Abrir la captura de inventario y crear **un único snapshot** con tipo
   `cierre`, semana 65 y fecha 30-08-2026.
2. Capturar cada producto en su unidad de conteo configurada (piezas,
   botellas, paquetes, kg, etc.); el sistema convertirá internamente a la
   unidad base.
3. Confirmar el corte diario del domingo: efectivo, tarjeta y propina si aplica.
4. Ejecutar la conciliación por producto:
   apertura + compras − consumo FIFO = inventario esperado;
   inventario físico − esperado = diferencia.
5. Clasificar cada diferencia como conversión, compra faltante, receta,
   captura o posible merma.
6. Sólo después calcular utilidad bruta, resultado operativo y patrimonio de la
   semana 65.

No se debe cerrar la semana ni crear una existencia de ajuste mientras falte el
conteo físico real.

## Actualización posterior — apertura Squirt y Costeo Maestro

La revisión del libro `IBERICO_FIFO_PILOTO_SEMANA_2026-08-10_16.xlsx` y la
comprobación en producción corrigieron dos puntos del estado anterior:

- Los **4 L de Squirt** confirmados por el ticket histórico se materializaron
  como un lote de apertura independiente: lote **407**, producto Squirt,
  4,000 ml iniciales, 4,000 ml restantes al momento de crear la apertura,
  costo base **$0.023/ml**, fecha de recepción 24-08-2026 y referencia
  `APERTURA-FIFO-65-SQUIRT-4L`. El lote histórico cancelado se conserva como
  auditoría; no se borró ni se reutilizó.
- El snapshot físico 59 de apertura contiene 2,000 ml en Local y 2,000 ml en
  Bodega (8,000 ml en total). Por ello, el lote de 4 L es una incorporación
  histórica explícita y debe contrastarse al cierre para descartar doble conteo;
  no se debe presentar como si el snapshot físico sólo tuviera 4 L.
- La receta de **Montado Sevillano (Quesos y Serrano)** quedó creada y validada
  en producción (receta 69, versión 1) con: pan 30 g, jamón serrano 10 g,
  mozzarella 5 g, gouda 5 g, manchego 5 g y miel Carlota 3 g. La fuente es la
  hoja `03_Recetas` del Costeo Maestro.

### Resultado del reprocesamiento de la semana 65

La ejecución idempotente del costeo dejó **85 líneas costeadas** y **6 líneas
pendientes**. Las pendientes son únicamente ventas de productos sin receta
operativa recuperable del Costeo Maestro:

- Agua mineral (producto independiente): 3 líneas, $75.00.
- Cuba de Ron: 1 línea, $70.00.
- Tabla de Tapas Mixtas: 1 línea, $165.00; requiere modelar la selección de
  tres montados, por lo que no se inventó un producto base.
- Clericot grande: 1 línea, $130.00.

El Costeo Maestro no contiene una receta autónoma y verificable para esos cuatro
casos. Permanecen como excepción de receta, no como faltante de inventario. El
Montado Sevillano ya no debe aparecer como pendiente de receta después de
actualizar la vista.

La consulta productiva quedó validada con el rango local de la semana 65
(24–30 agosto, zona operativa de México). Antes de cerrar, se debe volver a
ejecutar la conciliación para comprobar cuánto del lote 407 fue consumido y si
el snapshot físico confirma o contradice los 8 L registrados en la apertura.

## Actualización — conteo de cierre enlazado

El conteo físico que se realizó el domingo ya estaba guardado en producción:

- snapshot **60**, tipo `cierre`, semana 65;
- creado el 30 de agosto a las 20:50 hora de México;
- 152 líneas capturadas;
- valor físico calculado: **$35,237.42**.

El snapshot quedó enlazado a `inventario_semanal` de la semana 65 y se guardó el
valor de cierre sin cerrar todavía la semana. Se corrigió además el límite de
fecha del cierre: ahora considera el domingo operativo completo hasta las
06:00 UTC del lunes. Esto evita excluir conteos nocturnos por el cambio de zona
horaria.

### Domingo 30: estado de ventas y gastos

- Ya existe una línea Epos local del domingo por **$300.00**, 3 unidades de
  `CBA Doble D`, costeada contra FIFO por **$215.6143**. La importación diaria
  posterior fue idempotente y recibió cero filas, por lo que no se duplicó esa
  venta.
- No hay movimientos de gastos ni sueldos registrados para el 30 de agosto.
- La conciliación diaria del domingo permanece en `revision`, con Epos tarjeta
  por $300.00; todavía requiere confirmación humana.

No se añadió ningún gasto ni venta supuesto. Antes de cerrar la semana 65 se
debe confirmar si el corte de Epos del domingo sólo contiene esos $300.00 y
capturar los gastos reales del día, si existieron.

### Corrección del detalle persistido

La vista podía mostrar simultáneamente los $300.00 leídos de Epos y el mensaje
“No hay ventas persistidas”. La causa era una importación idempotente diaria con
cero filas: el listado filtraba sólo por esa importación y ocultaba la línea
que ya estaba guardada en una importación anterior, aunque su fecha sí pertenecía
al domingo operativo. El listado ahora combina la importación coincidente con el
rango temporal solicitado. Así se conserva la venta nocturna sin duplicarla y el
detalle de productos queda alineado con el importe del corte.
