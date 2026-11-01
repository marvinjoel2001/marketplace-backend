import { SALES } from './ecommerce-classifier.service';
import { contains, extractPrice, extractWhatsApp } from './text-signals';
import { normalizeText } from './tiktok-lives.types';

/** Evidence about an account gathered outside the live title (stored in TikTokSellerSignal). */
export interface SellerSignals {
  /** Its recent video captions mention sales. */
  videoSelling: boolean;
  /** Buyers asked prices / wrote "mío" in the chat of `chatRoomId` (or the host posted prices). */
  chatSelling: boolean;
  chatRoomId: string | null;
}

/**
 * How buyers write in a selling live's chat: "mío", "lo quiero", "precio?", "cuánto sale",
 * "talla M", "hacen envíos", "QR". Words are matched whole on accent-free, lowercase text with
 * stretched vowels collapsed ("miooo" → "mio", "cuantoooo" → "cuanto").
 */
const BUYER_TERMS = [
  'mio',
  'mia',
  'mios',
  'mias',
  'lo quiero',
  'la quiero',
  'los quiero',
  'las quiero',
  'yo quiero',
  'quiero uno',
  'quiero una',
  'me lo llevo',
  'me la llevo',
  'lo compro',
  'la compro',
  'separame',
  'separamelo',
  'separamela',
  'me separas',
  'apartame',
  'reservame',
  'precio',
  'precios',
  'precion',
  'cuanto',
  'a cuanto',
  'que precio',
  'q precio',
  'cuesta',
  'cuestan',
  'valor',
  'costo',
  'talla',
  'tallas',
  'medidas',
  'que colores',
  'otros colores',
  'hay en',
  'tienes en',
  'tiene en',
  'envio',
  'envios',
  'envian',
  'hacen envios',
  'delivery',
  'entregas',
  'qr',
  'pago',
  'transferencia',
  'whatsapp',
  'wsp',
  'wpp',
  'info',
  'informacion',
  'ubicacion',
  'direccion',
  'donde estan',
  'por mayor',
  'stock',
  'disponible',
  'hay stock',
  'cuantos quedan',
  'el numero',
  'numero de whatsapp',
];
/** Lot numbers buyers call out ("12 mío", "#5", "N° 3 la quiero"). */
const LOT_CLAIM = /(?:^|\s)(?:#|n|nro|num)?\s?\d{1,3}\s+(?:mio|mia|yo|quiero|separame|apartame)\b/;

function chatText(text: string): string {
  return normalizeText(text).replace(/([aeiou])\1+/g, '$1');
}

/** A chat comment that reads like a buyer (asks a price, claims an item, asks for delivery). */
export function isBuyerComment(text: string): boolean {
  const normalized = chatText(text);
  return (
    BUYER_TERMS.some((term) => contains(normalized, term)) ||
    LOT_CLAIM.test(normalized)
  );
}

/** A comment the host/shop wrote with a price, an order number or a sales word. */
export function isSellerComment(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    !!extractPrice(text) ||
    !!extractWhatsApp(text) ||
    SALES.some((term) => contains(normalized, term))
  );
}

export interface ChatSample {
  comments: { user: string; text: string }[];
  /** TikTok Shop products shown in the room. */
  products: number;
  /** Pinned messages (shops pin prices, WhatsApp and payment info). */
  pins: string[];
}

export interface ChatVerdict {
  selling: boolean;
  /** Buyer-like comments seen during the sample. */
  hits: number;
  buyers: number;
}

/**
 * Decides from a short chat sample whether a live is selling: TikTok Shop products, a pinned or
 * host message with a price/sales word, or several viewers asking prices / claiming items.
 * One viewer alone is not enough ("precio?" can be a joke), so it needs two different buyers.
 */
export function judgeChat(sample: ChatSample, host: string, minBuyerComments = 3): ChatVerdict {
  const buyers = new Set<string>();
  let hits = 0;
  let hostSells = false;
  for (const comment of sample.comments) {
    const user = comment.user.toLowerCase();
    if (user && user === host.toLowerCase()) {
      hostSells ||= isSellerComment(comment.text);
      continue;
    }
    if (!isBuyerComment(comment.text)) continue;
    hits += 1;
    buyers.add(user || `anon-${hits}`);
  }
  const pinnedSale = sample.pins.some(isSellerComment);
  return {
    selling:
      sample.products > 0 ||
      pinnedSale ||
      hostSells ||
      (hits >= minBuyerComments && buyers.size >= 2),
    hits,
    buyers: buyers.size,
  };
}

/** Sales words, prices or order numbers in the account's recent video captions. */
export function judgeCaptions(captions: string[], minVideos = 2): { selling: boolean; keywords: string[] } {
  const keywords = new Set<string>();
  let videos = 0;
  for (const caption of captions.slice(0, 30)) {
    const normalized = normalizeText(caption);
    const words = SALES.filter((term) => contains(normalized, term));
    const offer = !!extractPrice(caption) || !!extractWhatsApp(caption);
    if (!words.length && !offer) continue;
    videos += 1;
    words.slice(0, 5).forEach((word) => keywords.add(word));
    if (offer) keywords.add('precio');
  }
  // One sales video among many vlogs can be a one-off; repeated ones (or almost all) mean a shop.
  return {
    selling: videos >= Math.min(minVideos, Math.max(1, captions.length)),
    keywords: [...keywords].slice(0, 15),
  };
}
