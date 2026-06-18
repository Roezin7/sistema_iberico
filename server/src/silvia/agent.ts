import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { HttpError } from '../middleware/error.js';
import { contextoNegocio } from './context.js';

const MODELO = 'claude-opus-4-8';

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, 'Silvia no está configurada: falta ANTHROPIC_API_KEY en el servidor.');
  }
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

export const silviaDisponible = () => !!env.ANTHROPIC_API_KEY;

function systemPrompt(contexto: string, memoria: string): string {
  return `Eres **Silvia**, la coach de negocio del bar/restaurante. Hablas español de México, cercana pero directa y profesional, como una consultora que de verdad conoce el negocio de bares.

Tu trabajo: ayudar a los dueños con KPIs y métricas. Observas los números reales y das recomendaciones accionables — qué mejorar y qué mantener. Eres concreta: priorizas 1-3 acciones, explicas el porqué con los números, y evitas el relleno.

Reglas:
- USA solo los números que te doy en el contexto. NUNCA inventes cifras. Si falta un dato, dilo y sugiere capturarlo.
- Piensa como negocio de bar en México: margen, rotación de inventario, comisión de terminal (1.99%), control de efectivo y faltantes, costos de cerveza/licor, propinas, sueldos.
- Si detectas algo relevante y duradero del negocio (un patrón, una decisión, una preferencia, el efecto de un cambio), guárdalo con la herramienta recordar_aprendizaje para recordarlo en el futuro. No guardes trivialidades ni datos que ya están en los números.
- Toma en cuenta los eventos y aprendizajes previos (memoria) para dar continuidad: si el dueño hizo un cambio, evalúa su efecto.
- Responde en Markdown breve. Usa viñetas para las acciones. Nada de saludos largos ni disculpas.

## Contexto actual del negocio (datos reales)
${contexto}

## Memoria (eventos y aprendizajes previos)
${memoria || '(todavía no hay memoria registrada)'}`;
}

const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: 'recordar_aprendizaje',
    description:
      'Guarda un aprendizaje duradero sobre el negocio para recordarlo en conversaciones futuras (un patrón, el efecto de un cambio, una preferencia del dueño). Úsalo con moderación, solo para cosas que valga la pena recordar.',
    input_schema: {
      type: 'object',
      properties: {
        contenido: { type: 'string', description: 'El aprendizaje, en una o dos frases claras.' },
      },
      required: ['contenido'],
    },
  },
];

export interface RespuestaSilvia {
  texto: string;
  aprendizajes: string[];
}

/**
 * Corre una vuelta de conversación con Silvia. Carga contexto + memoria + historial,
 * llama a Claude con el loop de herramientas (puede guardar aprendizajes en su memoria),
 * y devuelve el texto de respuesta. NO escribe datos del negocio, solo su propia memoria.
 */
export async function conversar(negocioId: bigint, mensajeUsuario: string): Promise<RespuestaSilvia> {
  const cli = client();

  const [contexto, memoriaRows, historial] = await Promise.all([
    contextoNegocio(negocioId),
    prisma.silvia_memoria.findMany({ where: { negocio_id: negocioId }, orderBy: { id: 'desc' }, take: 30 }),
    prisma.silvia_mensajes.findMany({ where: { negocio_id: negocioId }, orderBy: { id: 'desc' }, take: 20 }),
  ]);

  const memoriaTxt = memoriaRows
    .reverse()
    .map((m) => `- [${m.tipo}${m.fecha ? ' ' + m.fecha.toISOString().slice(0, 10) : ''}] ${m.contenido}`)
    .join('\n');

  const messages: Anthropic.MessageParam[] = historial
    .reverse()
    .map((m) => ({ role: m.rol === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.contenido }));
  messages.push({ role: 'user', content: mensajeUsuario });

  const sys = systemPrompt(contexto, memoriaTxt);
  const aprendizajes: string[] = [];

  try {
    return await loopHerramientas(cli, sys, messages, negocioId, aprendizajes);
  } catch (e) {
    // Traducir errores de la API de Anthropic a algo accionable para el usuario.
    if (e instanceof Anthropic.APIError) {
      const msg = String((e as { message?: string }).message ?? '');
      if (/credit balance|too low|billing/i.test(msg)) {
        throw new HttpError(402, 'Silvia no tiene crédito: tu cuenta de Anthropic no tiene saldo. Agrega créditos en console.anthropic.com → Plans & Billing.');
      }
      if (e.status === 401) throw new HttpError(401, 'La API key de Anthropic es inválida o fue revocada.');
      if (e.status === 429) throw new HttpError(429, 'Silvia está saturada por ahora (límite de solicitudes). Intenta en un momento.');
      throw new HttpError(502, `La API de Anthropic devolvió un error: ${msg.slice(0, 200)}`);
    }
    throw e;
  }
}

async function loopHerramientas(
  cli: Anthropic,
  sys: string,
  messages: Anthropic.MessageParam[],
  negocioId: bigint,
  aprendizajes: string[],
): Promise<RespuestaSilvia> {
  // Loop de herramientas (máx 4 iteraciones por seguridad).
  for (let i = 0; i < 4; i++) {
    const resp = await cli.messages.create({
      model: MODELO,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: sys,
      tools: HERRAMIENTAS,
      messages,
    });

    if (resp.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: resp.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use' && block.name === 'recordar_aprendizaje') {
          const contenido = String((block.input as { contenido?: string }).contenido ?? '').trim();
          if (contenido) {
            await prisma.silvia_memoria.create({
              data: { negocio_id: negocioId, tipo: 'aprendizaje', contenido },
            });
            aprendizajes.push(contenido);
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Guardado.' });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Respuesta final: extraer el texto.
    const texto = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return { texto: texto || 'No pude generar una respuesta esta vez.', aprendizajes };
  }

  return { texto: 'Me enredé un poco con tantas vueltas; intenta de nuevo.', aprendizajes };
}
