import { openDB } from 'idb';

const db = () => openDB('iberico-borradores-compras', 1, { upgrade(d) { d.createObjectStore('capturas'); } });
export async function leerBorrador<T>(clave: string): Promise<T | undefined> { return (await db()).get('capturas', clave); }
export async function guardarBorrador(clave: string, valor: unknown) { await (await db()).put('capturas', valor, clave); }
export async function borrarBorrador(clave: string) { await (await db()).delete('capturas', clave); }
