-- La cerveza se capturaba por % de rejilla (Local, factor 48) y por caja (Bodega, factor 24).
-- A partir de ahora TODO se cuenta por unidad (botella): unidad_captura = 'unidad', factor = 1.
-- Solo afecta capturas futuras: cada renglón de inventario (inventory_lines) guarda su propio
-- factor al momento de capturar, así que los conteos históricos quedan intactos.
UPDATE "product_zone_units"
   SET "unidad_captura" = 'unidad',
       "factor" = 1
 WHERE "unidad_captura" IN ('rejilla_%', 'caja');
