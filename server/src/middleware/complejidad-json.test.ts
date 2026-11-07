import { describe, expect, it } from 'vitest';
import { jsonDemasiadoComplejo } from './complejidad-json.js';

describe('límite de complejidad antes de validar JSON', () => {
  it('acepta un inventario completo de 500 líneas', () => {
    expect(jsonDemasiadoComplejo({ lineas: Array.from({ length: 500 }, (_, i) => ({ product_id: i + 1, zona_id: 1, cantidad_base: 440, factor: 1000 })) })).toBe(false);
  });
  it('no penaliza una foto como cadena dentro del límite de bytes', () => {
    expect(jsonDemasiadoComplejo({ imagen: 'a'.repeat(1_000_000) })).toBe(false);
  });
  it('rechaza colecciones enormes antes de generar errores por elemento', () => {
    expect(jsonDemasiadoComplejo({ lineas: Array(1001).fill(null) })).toBe(true);
  });
  it('rechaza profundidad excesiva sin recursión de pila', () => {
    let body: unknown = 1;
    for (let i = 0; i < 100; i++) body = { hijo: body };
    expect(jsonDemasiadoComplejo(body)).toBe(true);
  });
  it('limita el total aunque cada colección sea pequeña', () => {
    expect(jsonDemasiadoComplejo(Array.from({ length: 100 }, () => Array(250).fill(0)))).toBe(true);
  });
});
