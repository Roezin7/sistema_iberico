-- Conversión verificada en el costeo de Ibérico:
-- el limón se compra por kilogramo y se consume por pieza.
-- Se conserva rendimiento_util=1 porque los ~14 limones/kg representan
-- contenido de compra, no merma.
UPDATE products
SET unidad_base = 'pieza',
    unidad_compra = 'kg',
    contenido_compra = 14,
    rendimiento_util = 1
WHERE active = true
  AND negocio_id = (SELECT id FROM negocios WHERE nombre = 'Ibérico' LIMIT 1)
  AND lower(trim(name)) IN ('limon', 'limón');
