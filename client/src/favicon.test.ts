import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const asset = (name: string) => readFileSync(new URL('../public/' + name, import.meta.url));
describe('favicon web de Ibérico', () => {
  it('mantiene el isotipo con la paleta actual', () => {
    const svg = asset('favicon.svg').toString('utf8');
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('<title>Ibérico</title>');
    for (const color of ['#292D14','#A09857','#C1B878','#6E753F','#D8D2A1']) expect(svg).toContain(color);
  });
  it('ofrece PNG de 32 px válido', () => {
    const png = asset('favicon-32.png');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
  });
  it('incluye imágenes ICO de 16, 32 y 48 px sin offsets rotos', () => {
    const ico = asset('favicon.ico');
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    [16,32,48].forEach((size,i) => {
      const at = 6 + i * 16, length = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12);
      expect(ico[at]).toBe(size); expect(ico[at + 1]).toBe(size);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      expect(ico.subarray(offset, offset + 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(ico.readUInt32BE(offset + 16)).toBe(size);
    });
  });
  it('declara los tres formatos y evita reutilizar la URL antigua en caché', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    for (const path of ['favicon.ico','favicon-32.png','favicon.svg']) expect(html).toContain(path + '?v=20261107');
    expect(html.indexOf('image/svg+xml')).toBeGreaterThan(html.indexOf('image/png'));
  });
});
