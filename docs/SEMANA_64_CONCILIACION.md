# Semana 64 — conciliación operativa

**Periodo:** 17–23 de agosto de 2026  
**Estado:** cerrada  
**Apertura:** snapshot 54, $35,897.01  
**Cierre corregido:** snapshot 59, $35,266.06  
**Apertura de la semana 65:** snapshot 59, $35,266.06

## Lectura financiera

| Indicador | Resultado |
| --- | ---: |
| Ventas operativas Epos, sin propina | $10,104.00 |
| Propina registrada aparte | $168.00 |
| Compras registradas | $3,089.64 |
| Costo de ventas FIFO activo | $4,155.59 |
| Costo FIFO normal | $4,104.24 |
| Costo FIFO por excepción | $51.35 |
| Utilidad bruta | $5,948.41 |
| Resultado operativo | $1,696.22 |
| Diferencia física valorizada | $2,544.36 |

El costo FIFO activo coincide con las ventas Epos costeadas. Esto valida la
asignación del costo de ventas, pero **no** valida todavía la existencia física:
la conciliación FIFO contra el conteo final permanece abierta con 78 productos
con incidencia.

### Pagos diarios

Los tres cortes diarios están conciliados por importe contra Epos. El 22 de
agosto contiene **$100.00 como `Card/Cash`**: el total sí está conciliado, pero
Epos no permite saber si fue efectivo o tarjeta. Se conserva como `otros` y no
se asigna silenciosamente a una cuenta.

## Compra vinculada

La compra de **$68.00** quedó registrada como `Compra local`, ticket
`CORRECCION-EXCEPCIONES-W64-20260821`, pagada por **Banco**, y vinculada al
movimiento operativo correspondiente. No se creó un segundo lote para los
lotes FIFO existentes de Viuda Sánchez y Perejil.

## Interpretación de diferencias

Las diferencias deben resolverse en este orden:

1. **Conversión de presentación:** paquete/caja/pieza/kg frente a la unidad
   base. El sistema ahora clasifica primero estas diferencias y muestra el
   factor esperado.
2. **Compra faltante:** existe físicamente, pero no hay compra o lote en el
   periodo.
3. **Receta:** el consumo teórico no representa la porción real.
4. **Captura:** la cantidad contada o la fecha de captura es incorrecta.
5. **Posible merma:** sólo después de descartar las cuatro causas anteriores.

No se deben ajustar existencias para eliminar una diferencia sin registrar el
motivo y la evidencia.

## Estado del control FIFO

- Las reversiones permanecen como historial y auditoría.
- El costo de ventas usa únicamente consumos FIFO activos.
- El costo normal y el costo por excepción se muestran por separado.
- Los lotes abiertos pasan a la semana 65; no se reinicia el costo al cambiar
  de semana.
- La semana 65 abre con el cierre físico corregido de la semana 64.

## Objetivo operativo de la semana 65

No es sólo obtener un margen. Es demostrar que el sistema puede responder, para
cada producto:

> ¿Cuánto había al abrir, cuánto entró, cuánto debió consumirse, cuánto quedó
> físicamente y qué evidencia explica la diferencia?

El cierre de la semana 65 sólo debe considerarse independiente cuando el
consumo FIFO activo y el consumo inferido del inventario físico coincidan, o
cuando cada diferencia tenga una incidencia resuelta y documentada.
