import { storeCategories } from '../stores.service';

describe('storeCategories', () => {
  it('guarda hasta tres rubros, sin repetidos ni espacios de más', () => {
    expect(storeCategories('Ropa')).toBe('Ropa');
    expect(storeCategories(' Ropa ,Calzado,  Ropa')).toBe('Ropa, Calzado');
    expect(storeCategories('Ropa, Calzado, Accesorios, Belleza')).toBe('Ropa, Calzado, Accesorios');
    expect(storeCategories(undefined)).toBe('');
  });
});
