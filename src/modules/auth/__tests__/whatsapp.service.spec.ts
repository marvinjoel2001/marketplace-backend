import { ServiceUnavailableException } from '@nestjs/common';
import { WhatsAppService } from '../whatsapp.service';

const make = (cfg: object) =>
  new WhatsAppService({ getWhatsApp: async () => ({ driver: 'LOG', baseUrl: '', apiKey: '', session: 'default', ...cfg }) } as never);

describe('WhatsAppService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    process.env.NODE_ENV = 'test';
  });

  it('LOG driver only prints in development and refuses in production', async () => {
    await expect(make({}).send('+591 71234567', 'hola')).resolves.toEqual({ delivered: false, devOnly: true });
    process.env.NODE_ENV = 'production';
    await expect(make({}).send('+591 71234567', 'hola')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('WAHA: posts chatId and text with the API key', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', { status: 201 }));
    global.fetch = fetchMock as never;
    await make({ driver: 'WAHA', baseUrl: 'http://waha:3000', apiKey: 'k', session: 'vitrina' }).send('+591 71234567', 'hola');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://waha:3000/api/sendText');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('k');
    expect(JSON.parse(init.body as string)).toEqual({ session: 'vitrina', chatId: '59171234567@c.us', text: 'hola' });
  });

  it('Evolution: posts number and text to the instance with the apikey header', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', { status: 201 }));
    global.fetch = fetchMock as never;
    await make({ driver: 'EVOLUTION', baseUrl: 'http://evo:8080', apiKey: 'k', session: 'vitrina' }).send('+591 71234567', 'hola');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://evo:8080/message/sendText/vitrina');
    expect((init.headers as Record<string, string>).apikey).toBe('k');
    expect(JSON.parse(init.body as string)).toEqual({ number: '59171234567', text: 'hola' });
  });

  it('turns a gateway failure into a friendly error', async () => {
    global.fetch = (async () => new Response('boom', { status: 500 })) as never;
    await expect(make({ driver: 'WAHA', baseUrl: 'http://waha:3000' }).send('+591 71234567', 'hola')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('status: connected only when the session is WORKING / open', async () => {
    global.fetch = (async () => new Response(JSON.stringify({ status: 'WORKING' }))) as never;
    expect((await make({ driver: 'WAHA', baseUrl: 'http://waha:3000' }).status()).connected).toBe(true);
    global.fetch = (async () => new Response(JSON.stringify({ instance: { state: 'close' } }))) as never;
    expect((await make({ driver: 'EVOLUTION', baseUrl: 'http://evo:8080' }).status()).connected).toBe(false);
  });
});
