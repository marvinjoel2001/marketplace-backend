import { PhotoAiService, parseJsonObject } from '../photo-ai.service';
import { SettingsService } from '../../settings/settings.service';

const MODEL = 'deepseek-ai/deepseek-v4.1-flash-1017';
const IMAGE = 'data:image/jpeg;base64,AAAA';

function service(keys = { anthropic: '', deploy: 'dk-test' }) {
  const prisma = {
    store: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
    category: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', slug: 'electro', name: 'Electrodomésticos' }]) },
  };
  const settings = {
    getVisionAi: jest.fn().mockResolvedValue({ enabled: true, model: MODEL, provider: 'deploy', apiKey: keys.deploy, keys }),
  };
  return new PhotoAiService(prisma as never, settings as never);
}

function reply(content: string, status = 200) {
  return {
    ok: status < 400,
    status,
    text: async () => content,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 1500, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 900 } },
    }),
  };
}

describe('PhotoAiService con Deploy', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('envía la foto en formato OpenAI, sin razonamiento y con la salida acotada', async () => {
    fetchMock.mockResolvedValue(reply(JSON.stringify({
      recognized: true, title: 'Licuadora Oster', category: 'electro', audience: 'Todos', condition: 'NUEVO',
      colors: ['negro'], description: 'Licuadora en su caja.', details: [{ name: 'Marca', value: 'Oster' }],
      variantAxis: '', variantOptions: [], bulky: false, priceRangeBs: { low: 300, high: 450 },
    })));
    const result = await service().analyze({ storeId: 's1', image: IMAGE });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api-cdn.deploy.com/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer dk-test');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: MODEL, reasoning_effort: 'none', max_completion_tokens: 900 });
    // Fixed text first (cacheable), the photo last.
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('electro (Electrodomésticos)');
    expect(body.messages[1].content.at(-1)).toEqual({ type: 'image_url', image_url: { url: IMAGE } });
    expect(result).toMatchObject({ title: 'Licuadora Oster', categoryId: 'c1', priceRangeBs: { low: 300, high: 450 } });
  });

  it('tolera bloques ```json y campos fuera de la lista', async () => {
    fetchMock.mockResolvedValue(reply('```json\n{"recognized": true, "title": "Taladro", "category": "otra", "audience": "Perros", "condition": "NUEVO"}\n```'));
    const result = await service().analyze({ storeId: 's1', image: IMAGE });
    expect(result).toMatchObject({ title: 'Taladro', categoryId: null, audience: 'Todos', colors: [], priceRangeBs: null });
  });

  it('pide llenar a mano si la respuesta no trae JSON', async () => {
    fetchMock.mockResolvedValue(reply('No puedo ver bien la imagen.'));
    await expect(service().analyze({ storeId: 's1', image: IMAGE })).rejects.toThrow('Llena los datos a mano');
  });

  it('explica una key inválida o sin saldo al probar la conexión', async () => {
    fetchMock.mockResolvedValueOnce(reply('Invalid or expired token', 401));
    await expect(service().testKey('mala', MODEL)).rejects.toThrow('La API key de Deploy no es válida');
    fetchMock.mockResolvedValueOnce(reply('Out of balance', 405));
    await expect(service().testKey('sin-saldo', MODEL)).rejects.toThrow('no tiene saldo');
  });

  it('la prueba de conexión gasta un solo token', async () => {
    fetchMock.mockResolvedValue(reply('ok'));
    await expect(service().testKey(undefined, MODEL)).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ max_completion_tokens: 1, reasoning_effort: 'none' });
  });

  it('pide la key de Deploy cuando falta', async () => {
    await expect(service({ anthropic: 'sk-ant', deploy: '' }).testKey(undefined, MODEL)).rejects.toThrow('API key de Deploy');
  });
});

describe('parseJsonObject', () => {
  it('extrae el objeto aunque haya texto alrededor', () => {
    expect(parseJsonObject('Aquí está: {"a": 1} listo')).toEqual({ a: 1 });
    expect(parseJsonObject('sin json')).toBeNull();
  });
});

describe('SettingsService: una key por proveedor', () => {
  it('guarda la key de Deploy sin borrar la de Anthropic y la usa al elegir DeepSeek', async () => {
    const store = new Map<string, string>([['vision_ai', JSON.stringify({ apiKey: 'sk-ant-1', model: 'claude-haiku-5-5' })]]);
    const prisma = {
      appSetting: {
        findUnique: jest.fn(async ({ where }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null)),
        upsert: jest.fn(async ({ where, create }) => store.set(where.key, create.value)),
      },
    };
    const settings = new SettingsService(prisma as never);
    const cfg = await settings.setVisionAi({ model: MODEL, apiKey: 'dk-1' });
    expect(cfg).toMatchObject({ provider: 'deploy', apiKey: 'dk-1', keys: { anthropic: 'sk-ant-1', deploy: 'dk-1' } });
    const back = await settings.setVisionAi({ model: 'claude-haiku-5-5' });
    expect(back).toMatchObject({ provider: 'anthropic', apiKey: 'sk-ant-1' });
  });
});
