import { BadRequestException } from '@nestjs/common';
import { normalizeAxis, normalizeVariants, parseVariants, totalStock } from '../variants';
import { PhotoAiService } from '../photo-ai.service';

describe('product options', () => {
  it('accepts any kind of option, not only clothing sizes', () => {
    const variants = normalizeVariants([
      { label: ' 110 V ', stock: 2 },
      { label: '220 V', stock: 0 },
    ]);
    expect(variants).toEqual([
      { label: '110 V', stock: 2 },
      { label: '220 V', stock: 0 },
    ]);
    expect(totalStock(variants!)).toBe(2);
  });

  it('treats an empty list as "no options"', () => {
    expect(normalizeVariants([])).toBeNull();
    expect(normalizeVariants(undefined)).toBeNull();
    expect(normalizeVariants([{ label: '  ', stock: 3 }])).toBeNull();
  });

  it('rejects repeated options and invalid quantities', () => {
    expect(() => normalizeVariants([{ label: 'M', stock: 1 }, { label: 'm', stock: 2 }])).toThrow(BadRequestException);
    expect(() => normalizeVariants([{ label: '100 ml', stock: -1 }])).toThrow(BadRequestException);
    expect(() => normalizeVariants([{ label: '40', stock: 1.5 }])).toThrow(BadRequestException);
  });

  it('reads stored JSON defensively', () => {
    expect(parseVariants('not json')).toEqual([]);
    expect(parseVariants(null)).toEqual([]);
    expect(parseVariants('[{"label":"38","stock":"3"},{"label":""}]')).toEqual([{ label: '38', stock: 3 }]);
  });

  it('keeps the axis as free text', () => {
    expect(normalizeAxis('  Presentación ')).toBe('Presentación');
    expect(normalizeAxis('')).toBeNull();
  });
});

describe('PhotoAiService without a key', () => {
  const settings = { getVisionAi: jest.fn().mockResolvedValue({ enabled: true, apiKey: '', model: 'claude-opus-5-5' }) };
  const service = new PhotoAiService({} as never, settings as never);

  it('reports the assistant as off so the form stays manual', async () => {
    await expect(service.status()).resolves.toEqual({ enabled: false });
  });

  it('refuses to analyse until the admin loads a key', async () => {
    await expect(service.analyze({ storeId: 's1', image: 'data:image/jpeg;base64,AAAA' })).rejects.toThrow('no está activado');
  });
});
