export interface PricedOffer {
  price: number;
  salePrice?: number | null;
  isFlashSale?: boolean;
  flashSaleEnd?: Date | string | null;
}

/** An offer's discount counts only while it hasn't expired; afterwards the regular price applies again. */
export function isPromoActive(offer: PricedOffer, now = new Date()): boolean {
  if (!offer.isFlashSale || !offer.salePrice || offer.salePrice >= offer.price) return false;
  return !offer.flashSaleEnd || new Date(offer.flashSaleEnd).getTime() > now.getTime();
}

export function effectivePrice(offer: PricedOffer, now = new Date()): number {
  return isPromoActive(offer, now) ? Number(offer.salePrice) : offer.price;
}
