import { productDescription } from '../photo-ai.service';

describe('la descripción habla del producto, no de la foto', () => {
  it('quita la frase que narra la foto y deja la del producto', () => {
    expect(
      productDescription(
        'Cajetilla de cigarrillos Bohem Double con empaque cerrado y advertencia sanitaria del Ministerio de Salud. Se ve el sabor mentolado en la etiqueta.',
      ),
    ).toBe('Cajetilla de cigarrillos Bohem Double con empaque cerrado y advertencia sanitaria del Ministerio de Salud.');
  });

  it.each([
    'En la foto aparece una licuadora Oster.',
    'La imagen muestra una polera negra.',
    'Se aprecian costuras reforzadas.',
    'En esta imagen se observa el empaque.',
  ])('detecta "%s"', (sentence) => {
    expect(productDescription(`Licuadora Oster de 10 velocidades. ${sentence}`)).toBe('Licuadora Oster de 10 velocidades.');
  });

  it('no toca una descripción que ya habla del producto', () => {
    const text = 'Cajetilla de cigarrillos Bohem Double sabor mentolado. Empaque cerrado, con advertencia sanitaria.';
    expect(productDescription(text)).toBe(text);
  });

  it('si todo narra la foto, deja el texto para que el vendedor lo corrija', () => {
    expect(productDescription('Se ve una gorra negra.')).toBe('Se ve una gorra negra.');
  });

  it('no confunde palabras parecidas', () => {
    const text = 'Gorra negra con visera curva. Tela que no se decolora.';
    expect(productDescription(text)).toBe(text);
  });
});
