import { BadRequestException } from '@nestjs/common';
import { DEFAULT_SUPPORT_MESSAGE, SettingsService, supportWhatsApp } from './settings.service';

describe('número de soporte por WhatsApp', () => {
  it.each([
    ['71234567', '59171234567'],
    ['7123 4567', '59171234567'],
    ['+591 71234567', '59171234567'],
    ['591 6 123 4567', '59161234567'],
    ['+54 9 11 1234 5678', '5491112345678'],
    ['0034 612 345 678', '34612345678'],
  ])('%s → %s', (input, expected) => expect(supportWhatsApp(input)).toBe(expected));

  it.each(['', '1234', '21234567', '5491112345678', '+0 123'])('rechaza %s', (input) => expect(supportWhatsApp(input)).toBeNull());
});

describe('ajustes de soporte', () => {
  function service(saved: unknown = null) {
    let row = saved === null ? null : { value: JSON.stringify(saved) };
    const prisma: any = {
      appSetting: {
        findUnique: jest.fn(() => Promise.resolve(row)),
        upsert: jest.fn(({ create }) => { row = { value: create.value }; return Promise.resolve(); }),
      },
    };
    return new SettingsService(prisma);
  }

  it('sin configurar no hay línea y usa el mensaje por defecto', async () => {
    await expect(service().getSupport()).resolves.toEqual({ whatsapp: '', message: DEFAULT_SUPPORT_MESSAGE, hours: '' });
  });

  it('guarda el número listo para wa.me, el mensaje y el horario', async () => {
    const s = service();
    await s.setSupport({ whatsapp: '7123 4567', message: ' Hola, soy {tienda} ', hours: 'Lunes a sábado, 9 a 19' });
    await expect(s.getSupport()).resolves.toEqual({ whatsapp: '59171234567', message: 'Hola, soy {tienda}', hours: 'Lunes a sábado, 9 a 19' });
  });

  it('dejar el número vacío quita la línea', async () => {
    const s = service({ whatsapp: '59171234567', message: 'x', hours: '' });
    await s.setSupport({ whatsapp: '' });
    expect((await s.getSupport()).whatsapp).toBe('');
  });

  it('rechaza un número que no sirve sin borrar el guardado', async () => {
    const s = service({ whatsapp: '59171234567', message: 'x', hours: '' });
    await expect(s.setSupport({ whatsapp: '123' })).rejects.toThrow(BadRequestException);
    expect((await s.getSupport()).whatsapp).toBe('59171234567');
  });
});
