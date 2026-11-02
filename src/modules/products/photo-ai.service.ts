import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService, VISION_MODELS, VisionModel, visionProvider } from '../settings/settings.service';
import { AUDIENCES, CONDITIONS } from './variants';

/** What the seller sees pre-filled after taking the photo. Every field stays editable. */
export interface PhotoSuggestion {
  recognized: boolean;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  audience: string;
  condition: string;
  colors: string[];
  description: string;
  details: { name: string; value: string }[];
  variantAxis: string;
  variantOptions: string[];
  bulky: boolean;
  priceRangeBs: { low: number; high: number } | null;
}

const SYSTEM = `Eres el asistente de Vitrina Market, un marketplace de Santa Cruz de la Sierra (Bolivia) donde tiendas pequeñas venden de todo: ropa, calzado, electrodomésticos, herramientas, perfumes, cosméticos, juguetes, artículos del hogar, muebles, tecnología, repuestos y más. Muchas tiendas tienen inventario rotativo: a veces una sola unidad de cada cosa.

El vendedor acaba de tomar una foto de un producto para publicarlo. Llena la ficha para que solo tenga que revisar y publicar:
- title: cómo lo buscaría un comprador boliviano, corto (máx. 60 caracteres): tipo de producto + marca o modelo si se ven + rasgo clave. Ej.: "Licuadora Oster 10 velocidades", "Taladro percutor Bosch 750 W", "Perfume Carolina Herrera 212 VIP 100 ml", "Polera oversize negra".
- category: la categoría de la lista que mejor encaje.
- audience: para quién es. Usa "Todos" para cosas que no son de una persona en particular (electrodomésticos, herramientas, hogar).
- condition: NUEVO si se ve en su empaque o sin uso; SEMINUEVO si está casi como nuevo; USADO si tiene señales claras de uso.
- colors: colores visibles del producto (no del fondo), en español, máximo 4.
- description: 1 o 2 frases simples y honestas de lo que se ve. No inventes garantías, envíos ni características que no se ven.
- details: de 2 a 6 datos útiles según el TIPO de producto, solo si se ven o se deducen con seguridad de la foto o la etiqueta. Ejemplos: ropa → material, corte; calzado → material, tipo de suela; electrodoméstico → marca, modelo, potencia, voltaje, capacidad; herramienta → marca, potencia, voltaje, inalámbrica o con cable; perfume → marca, contenido (ml), tipo (eau de parfum, eau de toilette); juguete → edad recomendada, material; mueble → material, medidas aproximadas; tecnología → marca, modelo, almacenamiento.
- variantAxis: cómo se llamarían las opciones si una tienda normalmente vende este producto en varias versiones: "Talla" (ropa), "Número" (calzado), "Edad" (ropa de niños), "Medida", "Color", "Capacidad", "Voltaje", "Presentación" (ml o gramos), "Modelo". Deja "" si lo normal es una sola versión (la mayoría de electrodomésticos, herramientas y muebles).
- variantOptions: las opciones típicas para ese eje en Bolivia (ej. tallas S, M, L, XL; números 36 a 42). Vacío si variantAxis es "".
- bulky: true solo si no entra en una moto de delivery (más de unos 50 × 40 × 40 cm o más de 20 kg): muebles grandes, refrigeradores, lavadoras, colchones, televisores grandes.
- priceRangeBs: rango de precio de venta habitual en Santa Cruz en bolivianos, según el estado. null si no puedes estimarlo con sensatez.
- recognized: false si la foto no muestra un producto que se pueda vender (borrosa, una persona sin producto, una pantalla en negro). En ese caso deja los demás campos vacíos o con su valor más neutro.

Escribe todo en español de Bolivia, sin emojis ni signos de exclamación.`;

/** Deploy's docs have no JSON mode, so the shape goes in the (cached) system prompt and is validated here. */
const JSON_FORMAT = `Responde solo con un objeto JSON válido, sin markdown ni texto antes o después, con exactamente estas claves:
{"recognized": true, "title": "", "category": "slug-de-la-lista", "audience": "${AUDIENCES.join('|')}", "condition": "${CONDITIONS.join('|')}", "colors": [""], "description": "", "details": [{"name": "", "value": ""}], "variantAxis": "", "variantOptions": [""], "bulky": false, "priceRangeBs": {"low": 0, "high": 0}}
priceRangeBs puede ser null.`;

const HOURLY_LIMIT_PER_STORE = 150;
/** Deploy's endpoint for clients outside the US (Bolivia); DEPLOY_BASE_URL overrides it. */
const DEPLOY_BASE_URL = process.env.DEPLOY_BASE_URL || 'https://api-cdn.deploy.com/api/v1';
/** The filled form is ~250 tokens; the cap only stops a runaway answer. */
const DEPLOY_MAX_OUTPUT_TOKENS = 900;

type Category = { id: string; slug: string; name: string };

/** Accepts the model's answer even when one field is slightly off, so the seller still gets the rest pre-filled. */
const looseOutput = z.object({
  recognized: z.boolean().catch(true),
  title: z.string().catch(''),
  category: z.string().catch(''),
  audience: z.enum(AUDIENCES).catch('Todos'),
  condition: z.enum(CONDITIONS).catch('NUEVO'),
  colors: z.array(z.string()).catch([]),
  description: z.string().catch(''),
  details: z.array(z.object({ name: z.string(), value: z.string() })).catch([]),
  variantAxis: z.string().catch(''),
  variantOptions: z.array(z.string()).catch([]),
  bulky: z.boolean().catch(false),
  priceRangeBs: z.object({ low: z.number(), high: z.number() }).nullable().catch(null),
});
type ModelOutput = z.infer<typeof looseOutput>;

class DeployError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

@Injectable()
export class PhotoAiService {
  private readonly logger = new Logger(PhotoAiService.name);
  private client?: { key: string; instance: Anthropic };
  private readonly usage = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Whether the photo assistant can be used: the seller form falls back to manual entry when it can't. */
  async status() {
    const cfg = await this.settings.getVisionAi();
    return { enabled: cfg.enabled && Boolean(cfg.apiKey) };
  }

  /** Checks a key (or the saved one) and model without analysing a photo. */
  async testKey(apiKey?: string, model?: string) {
    const cfg = await this.settings.getVisionAi();
    const chosen = VISION_MODELS.includes(model as VisionModel) ? (model as VisionModel) : cfg.model;
    const provider = visionProvider(chosen);
    const key = apiKey?.trim() || cfg.keys[provider];
    if (!key) throw new BadRequestException(`Primero pega la API key de ${provider === 'anthropic' ? 'Anthropic' : 'Deploy'}`);
    if (provider === 'deploy') {
      try {
        // A one-token answer is the cheapest way to prove the key, the balance and the model together.
        await this.deploy(key, chosen, [{ role: 'user', content: 'ok' }], 1, 15_000);
        return { ok: true, model: chosen, name: 'DeepSeek V4.1 Flash (Deploy)' };
      } catch (err) {
        throw new BadRequestException(describeError(err));
      }
    }
    try {
      const info = await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 }).models.retrieve(chosen);
      return { ok: true, model: info.id, name: info.display_name };
    } catch (err) {
      throw new BadRequestException(describeError(err));
    }
  }

  async analyze(input: { storeId?: string; image?: string }): Promise<PhotoSuggestion> {
    const cfg = await this.settings.getVisionAi();
    if (!cfg.enabled || !cfg.apiKey) throw new ServiceUnavailableException('El reconocimiento de fotos no está activado');

    const store = input.storeId
      ? await this.prisma.store.findFirst({ where: { OR: [{ id: input.storeId }, { slug: input.storeId }] }, select: { id: true } })
      : null;
    if (!store) throw new BadRequestException('No encontramos tu tienda');
    this.checkLimit(store.id);

    const image = String(input.image ?? '');
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!match) throw new BadRequestException('Envía la foto como imagen JPG, PNG o WebP');
    const [, mediaType, data] = match;
    if (data.length > 6_000_000) throw new BadRequestException('La foto es muy pesada');

    const categories = await this.prisma.category.findMany({ select: { id: true, slug: true, name: true }, orderBy: { name: 'asc' } });
    const categoryList = categories.map((c) => `${c.slug} (${c.name})`).join(', ');

    let out: ModelOutput | null;
    try {
      out = cfg.provider === 'deploy'
        ? await this.analyzeWithDeploy(cfg.apiKey, cfg.model, image, categoryList)
        : await this.analyzeWithAnthropic(cfg.apiKey, cfg.model, mediaType, data, categories, categoryList);
    } catch (err) {
      this.logger.warn(`Photo analysis failed: ${describeError(err)}`);
      throw new ServiceUnavailableException('No pudimos reconocer la foto ahora. Llena los datos a mano o prueba de nuevo.');
    }
    if (!out) throw new BadRequestException('No pudimos reconocer este producto. Llena los datos a mano.');
    return toSuggestion(out, categories);
  }

  private async analyzeWithAnthropic(
    apiKey: string, model: VisionModel, mediaType: string, data: string, categories: Category[], categoryList: string,
  ): Promise<ModelOutput | null> {
    const slugs = categories.map((c) => c.slug);
    const schema = z.object({
      recognized: z.boolean(),
      title: z.string(),
      category: slugs.length ? z.enum(slugs as [string, ...string[]]) : z.string(),
      audience: z.enum(AUDIENCES),
      condition: z.enum(CONDITIONS),
      colors: z.array(z.string()),
      description: z.string(),
      details: z.array(z.object({ name: z.string(), value: z.string() })),
      variantAxis: z.string(),
      variantOptions: z.array(z.string()),
      bulky: z.boolean(),
      priceRangeBs: z.object({ low: z.number(), high: z.number() }).nullable(),
    });
    const response = await this.anthropic(apiKey).beta.messages.parse({
      model,
      max_tokens: 8000,
      // Haiku has no server-side fallback; Opus and Sonnet re-run a declined photo on Anthropic's recommended model.
      ...(supportsFallback(model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data } },
            { type: 'text', text: `Categorías disponibles: ${categoryList || 'ninguna todavía'}.\nLlena la ficha de este producto.` },
          ],
        },
      ],
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
    return response.parsed_output;
  }

  /**
   * Token budget: everything before the photo (instructions, JSON shape, categories) is identical on
   * every call, so Deploy serves it from its prompt cache; thinking is off and the answer is capped.
   */
  private async analyzeWithDeploy(apiKey: string, model: VisionModel, image: string, categoryList: string): Promise<ModelOutput | null> {
    const response = await this.deploy(apiKey, model, [
      { role: 'system', content: `${SYSTEM}\n\n${JSON_FORMAT}\n\nCategorías disponibles (usa el slug): ${categoryList || 'ninguna todavía'}.` },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Llena la ficha de este producto.' },
          { type: 'image_url', image_url: { url: image } },
        ],
      },
    ], DEPLOY_MAX_OUTPUT_TOKENS);
    const usage = response.usage;
    if (usage) {
      this.logger.log(
        `Foto con Deploy: ${usage.prompt_tokens ?? 0} tokens de entrada (${usage.prompt_tokens_details?.cached_tokens ?? 0} en caché), ${usage.completion_tokens ?? 0} de salida`,
      );
    }
    const parsed = looseOutput.safeParse(parseJsonObject(response.choices?.[0]?.message?.content ?? ''));
    return parsed.success ? parsed.data : null;
  }

  /** Deploy's OpenAI-compatible chat completions (https://docs.deploy.com/quickstart). */
  private async deploy(apiKey: string, model: string, messages: unknown[], maxTokens: number, timeout = 60_000) {
    const res = await fetch(`${DEPLOY_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_completion_tokens: maxTokens,
        // Reasoning tokens are billed as output; reading a product photo doesn't need them.
        reasoning_effort: 'none',
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new DeployError(res.status, (await res.text().catch(() => '')).slice(0, 200));
    return (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
  }

  private anthropic(apiKey: string) {
    if (this.client?.key !== apiKey) this.client = { key: apiKey, instance: new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }) };
    return this.client.instance;
  }

  /** Keeps one store from spending the platform's key without limit. */
  private checkLimit(storeId: string) {
    const hourAgo = Date.now() - 3_600_000;
    const recent = (this.usage.get(storeId) ?? []).filter((t) => t > hourAgo);
    if (recent.length >= HOURLY_LIMIT_PER_STORE)
      throw new HttpException('Subiste muchas fotos seguidas. Espera unos minutos o llena los datos a mano.', HttpStatus.TOO_MANY_REQUESTS);
    recent.push(Date.now());
    this.usage.set(storeId, recent);
  }
}

/** Turns the model's answer into what the seller form receives, trimming every field to safe sizes. */
export function toSuggestion(out: ModelOutput, categories: Category[]): PhotoSuggestion {
  const category = categories.find((c) => c.slug === out.category) ?? null;
  const range = out.priceRangeBs && out.priceRangeBs.low > 0 && out.priceRangeBs.high >= out.priceRangeBs.low ? out.priceRangeBs : null;
  const axis = out.variantAxis.trim().slice(0, 30);
  return {
    recognized: out.recognized,
    title: out.title.trim().slice(0, 120),
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    audience: out.audience,
    condition: out.condition,
    colors: out.colors.map((c) => c.trim()).filter(Boolean).slice(0, 4),
    description: out.description.trim().slice(0, 600),
    details: out.details.filter((d) => d.name.trim() && d.value.trim()).slice(0, 6),
    variantAxis: axis,
    variantOptions: axis ? Array.from(new Set<string>(out.variantOptions.map((o) => o.trim()).filter(Boolean))).slice(0, 20) : [],
    bulky: out.bulky,
    priceRangeBs: range ? { low: Math.round(range.low), high: Math.round(range.high) } : null,
  };
}

/** The JSON object in a chat answer, tolerating ```json fences or stray text around it. */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function supportsFallback(model: VisionModel) {
  return model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';
}

function describeError(err: unknown): string {
  if (err instanceof DeployError) {
    if (err.status === 401) return 'La API key de Deploy no es válida';
    if (err.status === 405) return 'La cuenta de Deploy no tiene saldo';
    if (err.status === 429) return 'Deploy pidió esperar un momento (límite de uso)';
    if (err.status === 400) return `Deploy rechazó la solicitud (${err.message || 'formato inválido'})`;
    return `Deploy respondió con un error (${err.status})`;
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'El servicio tardó demasiado en responder';
  if (err instanceof Anthropic.AuthenticationError) return 'La API key no es válida';
  if (err instanceof Anthropic.PermissionDeniedError) return 'La API key no tiene permiso para usar este modelo';
  if (err instanceof Anthropic.NotFoundError) return 'Ese modelo no está disponible para esta API key';
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic pidió esperar un momento (límite de uso)';
  if (err instanceof Anthropic.APIConnectionError) return 'No pudimos conectar con Anthropic';
  if (err instanceof Anthropic.APIError) return `Anthropic respondió con un error (${err.status ?? 'sin código'})`;
  if (err instanceof TypeError) return 'No pudimos conectar con el servicio de IA';
  return (err as Error)?.message || 'Error desconocido';
}
