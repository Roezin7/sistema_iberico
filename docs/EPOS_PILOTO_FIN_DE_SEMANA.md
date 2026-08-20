# Piloto Ibérico — ventas Epos y corte diario

## Qué queda conectado

Ibérico puede consultar Epos Now en modo de solo lectura y persistir una copia auditable de las líneas del periodo:

- ventas por producto;
- cantidad;
- importe bruto y neto cuando Epos lo devuelve;
- descuento;
- método de pago;
- fecha y hora;
- IDs de transacción y producto de Epos;
- payload original de la consulta.

La importación es idempotente: repetir el mismo periodo actualiza la evidencia y no crea ventas duplicadas.

La importación no descuenta inventario, no crea compras y no confirma un cierre. Es el puente de evidencia para validar primero ventas, recetas y equivalencias.

## Flujo de cada día con ventas

1. Al terminar la operación, abrir el sistema con sesión de administrador.
2. Ejecutar el cierre diario de la fecha que acaba de terminar. El endpoint calcula el día completo en horario de México (`-06:00`):

   `POST /api/epos/sync-daily`

   ```json
   { "fecha": "2026-08-21" }
   ```

3. Revisar venta total, efectivo, tarjeta, otros, productos vendidos, diferencias entre `DailySales` y `BookkeepingReport`, filas nuevas y filas duplicadas.
4. Confirmar manualmente el corte en `POST /api/epos/conciliaciones-diarias`, usando el `semana_id` abierto y los importes verificados.
5. Registrar en `notas` cuentas abiertas, pagos tardíos o excepciones. Una cuenta que se cierre después se corrige en la conciliación, no se duplica como venta.

## Días sin ventas

No se debe crear una captura artificial de cero. Se deja constancia sólo si existe una razón operativa para demostrar que el día fue revisado. La semana financiera sigue siendo lunes-domingo, pero el piloto captura únicamente los días con operación real.

## Prueba histórica antes del fin de semana

Para comprobar idempotencia se puede importar una semana histórica completa:

```json
{
  "from": "2026-08-10T00:00:00-06:00",
  "to": "2026-08-17T00:00:00-06:00"
}
```

Usar `POST /api/epos/sync`. La primera ejecución debe reportar filas nuevas; la segunda debe reportar las mismas filas como duplicadas y mantener el mismo `importacion_id`.

## Criterio de éxito del piloto

- El total de Epos coincide con la conciliación diaria confirmada.
- Los métodos de pago quedan registrados por día.
- Repetir una consulta no duplica ventas.
- Cada producto queda disponible para asociarlo a una receta.
- Ninguna venta modifica inventario automáticamente mientras existan recetas o unidades pendientes de confirmar.
- Compras y tickets se siguen registrando por separado y con confirmación.

## Siguiente paso después del piloto

Con tres días reales confirmados se puede activar el siguiente bloque:

1. Resolver nombres/IDs de Epos contra `productos_menu`.
2. Calcular consumo teórico por receta.
3. Aplicar FIFO sólo a productos con receta confirmada.
4. Comparar consumo teórico contra inventario físico.
5. Abrir incidencias de merma o porción, sin alterar el cierre histórico.
