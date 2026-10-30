import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService, VisionModel } from '../settings/settings.service';
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

const HOURLY_LIMIT_PER_STORE = 150;

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
    const key = apiKey?.trim() || cfg.apiKey;
    if (!key) throw new BadRequestException('Primero pega la API key de Anthropic');
    try {
      const info = await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 }).models.retrieve(model || cfg.model);
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

    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(input.image ?? ''));
    if (!match) throw new BadRequestException('Envía la foto como imagen JPG, PNG o WebP');
    const [, mediaType, data] = match;
    if (data.length > 6_000_000) throw new BadRequestException('La foto es muy pesada');

    const categories = await this.prisma.category.findMany({ select: { id: true, slug: true, name: true }, orderBy: { name: 'asc' } });
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
    const categoryList = categories.map((c) => `${c.slug} (${c.name})`).join(', ');

    let response;
    try {
      response = await this.anthropic(cfg.apiKey).beta.messages.parse({
        model: cfg.model,
        max_tokens: 8000,
        // Haiku has no server-side fallback; Opus and Sonnet re-run a declined photo on Anthropic's recommended model.
        ...(supportsFallback(cfg.model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
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
    } catch (err) {
      this.logger.warn(`Photo analysis failed: ${describeError(err)}`);
      throw new ServiceUnavailableException('No pudimos reconocer la foto ahora. Llena los datos a mano o prueba de nuevo.');
    }

    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      throw new BadRequestException('No pudimos reconocer este producto. Llena los datos a mano.');
    }
    const out = response.parsed_output;
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

function supportsFallback(model: VisionModel) {
  return model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'La API key no es válida';
  if (err instanceof Anthropic.PermissionDeniedError) return 'La API key no tiene permiso para usar este modelo';
  if (err instanceof Anthropic.NotFoundError) return 'Ese modelo no está disponible para esta API key';
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic pidió esperar un momento (límite de uso)';
  if (err instanceof Anthropic.APIConnectionError) return 'No pudimos conectar con Anthropic';
  if (err instanceof Anthropic.APIError) return `Anthropic respondió con un error (${err.status ?? 'sin código'})`;
  return (err as Error)?.message || 'Error desconocido';
}
