export interface AdvertenciaPostGuardado {
  etapa: 'costeo_fifo' | 'mapeo_epos';
  mensaje: string;
}

/** Sólo DESPUÉS de un COMMIT exitoso: una falla aquí no significa que la
 * compra/pago/importación haya fallado, y nunca debe provocar recaptura. */
export async function intentarPostGuardado<T>(etapa: AdvertenciaPostGuardado['etapa'], operacion: () => Promise<T>) {
  try {
    return { resultado: await operacion(), advertencia: null };
  } catch (error) {
    console.warn(`[post-guardado] ${etapa}: ${error instanceof Error ? error.message : 'Fallo no identificado'}`);
    const advertencia: AdvertenciaPostGuardado = {
      etapa,
      mensaje: etapa === 'costeo_fifo'
        ? 'Los datos se guardaron. El costeo FIFO quedó pendiente por un error técnico; revisa y reintenta el costeo sin volver a capturar ventas ni pagos.'
        : 'Las ventas se guardaron. La revisión automática de vínculos Epos quedó pendiente; revisa los mapeos antes de dar el costo por completo.',
    };
    return { resultado: null, advertencia };
  }
}
