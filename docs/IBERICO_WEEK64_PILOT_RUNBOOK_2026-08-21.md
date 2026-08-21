# Runbook de prueba real — semana 64

Este documento es la guía operativa para la semana 64. No reemplaza la
confirmación humana y no autoriza modificar la semana 63.

## 1. Antes de vender

- Abrir Ibérico en la semana 64.
- Confirmar que el inventario de apertura es el snapshot 52.
- Verificar que no aparezca una nueva apertura creada por error.
- Revisar que las compras pendientes tengan foto y proveedor.

## 2. Cada compra

1. Tomar una foto legible del ticket.
2. Capturar proveedor, fecha y total.
3. Confirmar cantidades y presentación real: paquete, botella, caja, bolsa,
   pieza, gramos o mililitros.
4. Asociar cada línea al producto interno.
5. Clasificar como `inventario`, `gasto` o `pendiente`.
6. Elegir banco o caja como origen de pago.
7. Confirmar que la suma de líneas coincide con el total del ticket.
8. Aprobar. Sólo entonces se crea el lote FIFO y el movimiento financiero.

## 3. Cada día con ventas

1. Sincronizar Epos para el intervalo exacto del día.
2. Confirmar que la importación sea nueva o que sea un duplicado idempotente.
3. Revisar total, efectivo, tarjeta, otros y cuentas abiertas.
4. Registrar el corte diario.
5. Confirmarlo después de comparar con la caja y la terminal externa.
6. Ejecutar vista previa FIFO.
7. Resolver únicamente excepciones verificables.

## 4. Qué hacer con excepciones

- `Producto sin mapeo`: asociar producto Epos con el menú.
- `Sin receta validada`: confirmar la receta antes de costear.
- `Inventario insuficiente`: revisar compra, presentación, unidad y conteo.
- `Cuenta abierta`: conservarla como saldo pendiente; no forzarla a efectivo.
- `Ticket duplicado`: no crear otra compra ni otro lote.

## 5. Cierre del domingo

- Confirmar el último corte Epos.
- Registrar gastos y sueldos faltantes.
- Capturar inventario físico por producto y unidad base.
- Comparar teórico contra físico.
- Clasificar cada diferencia.
- Revisar costo FIFO, merma y margen.
- Cerrar la semana 64 sólo después de la revisión.
- Usar el snapshot final como apertura de la semana 65.

## 6. Evidencia mínima que debe quedar

- importación Epos por día;
- conciliación diaria confirmada;
- fotos de tickets;
- líneas aprobadas;
- lotes FIFO creados;
- excepciones resueltas o aceptadas;
- conteo físico final;
- revisión semanal.
