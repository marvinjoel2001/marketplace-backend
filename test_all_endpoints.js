/**
 * Automated Test Suite for All Endpoints in CompraYa / Vitrina Marketplace Backend (NestJS)
 * Base URL: http://localhost:4000/api/v1
 */

const BASE_URL = process.env.API_URL || 'http://localhost:4000/api/v1';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });
    const duration = Date.now() - start;
    let data;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return {
      status: res.status,
      ok: res.ok,
      duration,
      data,
    };
  } catch (err) {
    const duration = Date.now() - start;
    return {
      status: 0,
      ok: false,
      duration,
      error: err.message,
    };
  }
}

let passed = 0;
let failed = 0;
const results = [];

function recordResult(name, method, path, res, condition, details = '') {
  const isPass = res.ok && condition;
  if (isPass) {
    passed++;
    console.log(`\x1b[32m✔ [PASS]\x1b[0m ${method.padEnd(6)} ${path.padEnd(38)} (${res.status}) - ${res.duration}ms ${details}`);
  } else {
    failed++;
    console.log(`\x1b[31m✖ [FAIL]\x1b[0m ${method.padEnd(6)} ${path.padEnd(38)} (${res.status || 'ERR'}) - ${res.duration}ms: ${JSON.stringify(res.data || res.error)}`);
  }
  results.push({ name, method, path, status: res.status, pass: isPass, duration: res.duration });
}

async function runAllTests() {
  console.log('\n===============================================================');
  console.log(`🚀 Probando TODOS los endpoints de marketplace_backend: ${BASE_URL}`);
  console.log('===============================================================\n');

  // Shared state across tests
  let createdStoreId = null;
  let createdProductId = null;
  let createdOrderId = null;
  let createdUserId = null;
  let createdShiftId = null;
  let sampleCategorySlug = null;
  let sampleCategoryId = null;

  // -----------------------------------------------------------------
  // 1. CATEGORIES MODULE
  // -----------------------------------------------------------------
  console.log('\x1b[34m--- 1. Categories Endpoints ---\x1b[0m');
  {
    const res = await request('/categories');
    const isArray = Array.isArray(res.data) && res.data.length > 0;
    if (isArray) {
      sampleCategorySlug = res.data[0].slug;
      sampleCategoryId = res.data[0].id;
    }
    recordResult('List all categories', 'GET', '/categories', res, isArray, `[${res.data?.length} categorías encontradas]`);
  }

  {
    const slugToTest = sampleCategorySlug || 'electronica-y-tecnologia';
    const res = await request(`/categories/${slugToTest}`);
    recordResult('Get category by slug', 'GET', `/categories/${slugToTest}`, res, res.data && res.data.slug === slugToTest, `[${res.data?.name}]`);
  }

  // -----------------------------------------------------------------
  // 2. STORES MODULE
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- 2. Stores Endpoints ---\x1b[0m');
  {
    const res = await request('/stores');
    recordResult('List all stores', 'GET', '/stores', res, Array.isArray(res.data), `[${res.data?.length} tiendas]`);
  }

  {
    const res = await request('/stores?isLive=true');
    recordResult('List live stores', 'GET', '/stores?isLive=true', res, Array.isArray(res.data));
  }

  {
    const testStoreName = `Test Store Auto ${Date.now().toString().slice(-4)}`;
    const res = await request('/stores', {
      method: 'POST',
      body: JSON.stringify({
        name: testStoreName,
        category: 'Tecnología y Audio',
        address: 'Av. Las Américas #100, Santa Cruz',
        phone: '+591 70011223',
        description: 'Tienda de pruebas automatizadas E2E',
        tiktokUsername: 'test_store_bo',
      }),
    });
    if (res.ok && res.data?.id) {
      createdStoreId = res.data.id;
    }
    recordResult('Create new store', 'POST', '/stores', res, Boolean(res.data?.id), `[ID: ${res.data?.id}]`);
  }

  {
    const storeIdOrSlug = createdStoreId || 'techplus-bolivia';
    const res = await request(`/stores/${storeIdOrSlug}`);
    recordResult('Get store by ID or Slug', 'GET', `/stores/${storeIdOrSlug}`, res, Boolean(res.data?.id));
  }

  // -----------------------------------------------------------------
  // 3. PRODUCTS MODULE
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- 3. Products Endpoints ---\x1b[0m');
  {
    const res = await request('/products');
    recordResult('List all products', 'GET', '/products', res, Array.isArray(res.data), `[${res.data?.length} productos]`);
  }

  {
    const res = await request('/products?q=iPhone');
    recordResult('Filter products by search q', 'GET', '/products?q=iPhone', res, Array.isArray(res.data));
  }

  {
    const res = await request('/products?flashSale=true');
    recordResult('Filter products by flashSale', 'GET', '/products?flashSale=true', res, Array.isArray(res.data));
  }

  {
    const testTitle = `Producto Test E2E ${Date.now().toString().slice(-4)}`;
    const res = await request('/products', {
      method: 'POST',
      body: JSON.stringify({
        title: testTitle,
        description: 'Audífonos inalámbricos de alta fidelidad para pruebas',
        basePrice: 199.5,
        categoryId: sampleCategoryId || 'cmtn858xu0002fa2341id31ao',
        storeId: createdStoreId || 'cmtn858zm000hfa23j73l87sp',
        images: ['https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=500'],
        stock: 25,
        warranty: '1 año de garantía oficial',
        hasInvoice: true,
      }),
    });
    if (res.ok && res.data?.id) {
      createdProductId = res.data.id;
    }
    recordResult('Create new product', 'POST', '/products', res, Boolean(res.data?.id), `[ID: ${res.data?.id}]`);
  }

  {
    const prodIdOrSlug = createdProductId || 'iphone-15-pro-max-256gb-titanio-natural';
    const res = await request(`/products/${prodIdOrSlug}`);
    recordResult('Get product by ID or Slug', 'GET', `/products/${prodIdOrSlug}`, res, Boolean(res.data?.id));
  }

  if (createdProductId) {
    const res = await request(`/products/${createdProductId}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: `Producto Test Modificado ${Date.now().toString().slice(-4)}`,
        basePrice: 249.99,
        description: 'Descripción actualizada con éxito',
      }),
    });
    recordResult('Update product (PUT)', 'PUT', `/products/:id`, res, res.data?.basePrice === 249.99);
  }

  if (createdProductId) {
    const res = await request(`/products/${createdProductId}/stock`, {
      method: 'PATCH',
      body: JSON.stringify({
        storeId: createdStoreId || 'cmtn858zm000hfa23j73l87sp',
        stock: 50,
        price: 239.0,
      }),
    });
    recordResult('Update product stock & price (PATCH)', 'PATCH', `/products/:id/stock`, res, res.data?.stock === 50);
  }

  // -----------------------------------------------------------------
  // 4. ORDERS MODULE
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- 4. Orders Endpoints ---\x1b[0m');
  {
    const res = await request('/orders');
    recordResult('List orders', 'GET', '/orders', res, Array.isArray(res.data), `[${res.data?.length} pedidos]`);
  }

  {
    const res = await request('/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Cliente Test E2E',
        customerEmail: 'test.e2e@vitrinamarket.bo',
        customerPhone: '+591 78945612',
        customerAddress: 'Av. Busch y 2do Anillo #400, Santa Cruz',
        customerLat: -17.7712,
        customerLng: -63.1905,
        paymentMethod: 'QR_SIMPLE',
        shippingFee: 15.0,
        items: [
          {
            productTitle: 'Audífonos Bluetooth Test',
            storeId: createdStoreId || 'cmtn858zm000hfa23j73l87sp',
            storeName: 'Tienda Test',
            unitPrice: 150.0,
            quantity: 1,
            storeAddress: 'Equipetrol Norte',
            storeLat: -17.768,
            storeLng: -63.195,
          },
        ],
      }),
    });
    if (res.ok && res.data?.id) {
      createdOrderId = res.data.id;
    }
    recordResult('Create new order', 'POST', '/orders', res, Boolean(res.data?.orderNumber), `[Orden: ${res.data?.orderNumber}]`);
  }

  {
    const orderRef = createdOrderId || 'CY-894120-412';
    const res = await request(`/orders/${orderRef}`);
    recordResult('Get order by ID or orderNumber', 'GET', `/orders/${orderRef}`, res, Boolean(res.data?.orderNumber || res.data?.id));
  }

  if (createdOrderId) {
    const res = await request(`/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'DELIVERED',
      }),
    });
    recordResult('Update order status (PATCH)', 'PATCH', `/orders/:id/status`, res, res.data?.status === 'DELIVERED');
  }

  {
    const res = await request('/orders/webhook/dsp', {
      method: 'POST',
      body: JSON.stringify({
        orderId: createdOrderId || 'CY-894120-412',
        status: 'DELIVERED',
        event: 'order.delivered',
        driverName: 'Carlos Chofer OpenDSP',
        driverPhone: '+591 77112233',
      }),
    });
    recordResult('Handle DSP Webhook', 'POST', '/orders/webhook/dsp', res, Boolean(res.data?.id || res.data?.status));
  }

  // -----------------------------------------------------------------
  // 5. LIVE STREAMS MODULE
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- 5. Live Streams Endpoints ---\x1b[0m');
  {
    const res = await request('/live-streams');
    recordResult('List live streams', 'GET', '/live-streams', res, Array.isArray(res.data));
  }

  {
    const res = await request('/live-streams', {
      method: 'POST',
      body: JSON.stringify({
        storeId: createdStoreId || 'cmtn858zm000hfa23j73l87sp',
        title: 'Gran Transmisión E2E en Vivo por TikTok',
        streamerName: 'Presentador Test',
        tiktokUrl: 'https://www.tiktok.com/@tiendatest/live',
      }),
    });
    recordResult('Create live stream', 'POST', '/live-streams', res, Boolean(res.data?.id));
  }

  // -----------------------------------------------------------------
  // 6. DSP LOGISTICS INTEGRATION
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- 6. DSP Logistics Endpoints ---\x1b[0m');
  {
    const res = await request('/dsp/quote', {
      method: 'POST',
      body: JSON.stringify({
        pickupLat: -17.7685,
        pickupLng: -63.1952,
        dropoffLat: -17.785,
        dropoffLng: -63.18,
        declaredValue: 200,
      }),
    });
    recordResult('Get DSP shipping quote', 'POST', '/dsp/quote', res, res.data && typeof res.data.price === 'number', `[Bs. ${res.data?.price} - ${res.data?.distanceKm} km]`);
  }

  {
    const res = await request('/dsp/track/trk_tok_test_123');
    recordResult('Get DSP tracking by token', 'GET', '/dsp/track/:token', res, Boolean(res.data?.trackingToken || res.data?.status));
  }

  // -----------------------------------------------------------------
  // 7. ADMIN MODULE
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- 7. Admin Endpoints ---\x1b[0m');
  {
    const res = await request('/admin/stats');
    recordResult('Get Admin platform stats', 'GET', '/admin/stats', res, typeof res.data?.totalStores === 'number', `[Tiendas: ${res.data?.totalStores}, Pedidos: ${res.data?.totalOrders}]`);
  }

  // -----------------------------------------------------------------
  // 8. AUTH MODULE
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- 8. Auth Endpoints ---\x1b[0m');
  {
    const testEmail = `usuario.test.${Date.now()}@bolivia.bo`;
    const res = await request('/auth/social-login', {
      method: 'POST',
      body: JSON.stringify({
        email: testEmail,
        name: 'Marvin Test User',
        provider: 'TIKTOK',
      }),
    });
    if (res.ok && res.data?.user?.id) {
      createdUserId = res.data.user.id;
    }
    recordResult('Social login / register', 'POST', '/auth/social-login', res, Boolean(res.data?.user?.id), `[User ID: ${res.data?.user?.id}]`);
  }

  if (createdUserId) {
    const res = await request('/auth/enrich-profile', {
      method: 'POST',
      body: JSON.stringify({
        userId: createdUserId,
        phone: '+591 77123456',
        city: 'Santa Cruz de la Sierra',
        address: 'Calle René Moreno #230',
        nitOrCi: '8492019012',
      }),
    });
    recordResult('Enrich user profile', 'POST', '/auth/enrich-profile', res, res.data?.isProfileComplete === true);
  }

  if (createdUserId) {
    const res = await request('/auth/sync-interests', {
      method: 'POST',
      body: JSON.stringify({
        userId: createdUserId,
        interestProfile: JSON.stringify({ favoriteCategories: ['electronica-y-tecnologia'] }),
      }),
    });
    recordResult('Sync user interests', 'POST', '/auth/sync-interests', res, Boolean(res.data?.success && res.data?.user?.id));
  }

  if (createdUserId) {
    const res = await request(`/auth/me/${createdUserId}`);
    recordResult('Get user profile by ID', 'GET', `/auth/me/:id`, res, res.data?.id === createdUserId);
  }

  // -----------------------------------------------------------------
  // 9. CASH REGISTER MODULE (POS)
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- 9. Cash Register (POS) Endpoints ---\x1b[0m');
  const posStoreId = createdStoreId || 'cmtn858zm000hfa23j73l87sp';

  {
    // Close any previous shift if open to allow fresh opening
    const cur = await request(`/cash-register/shifts/current/${posStoreId}`);
    if (cur.ok && cur.data?.id) {
      await request(`/cash-register/shifts/${cur.data.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ actualCash: 100, notes: 'Cierre preventivo para test' }),
      });
    }

    const res = await request('/cash-register/shifts/open', {
      method: 'POST',
      body: JSON.stringify({
        storeId: posStoreId,
        cashierName: 'Cajero Principal Marvin',
        initialCash: 250.0,
        notes: 'Apertura de turno de prueba',
      }),
    });
    if (res.ok && res.data?.id) {
      createdShiftId = res.data.id;
    }
    recordResult('Open cash register shift', 'POST', '/cash-register/shifts/open', res, Boolean(res.data?.id), `[Shift ID: ${res.data?.id}]`);
  }

  {
    const res = await request(`/cash-register/shifts/current/${posStoreId}`);
    recordResult('Get current active shift', 'GET', `/cash-register/shifts/current/:storeId`, res, Boolean(res.data?.id && res.data.status === 'OPEN'));
  }

  if (createdShiftId) {
    const res = await request(`/cash-register/shifts/${createdShiftId}/movements`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'SALE_CASH',
        amount: 85.5,
        description: 'Venta presencial en tienda de audífonos',
      }),
    });
    recordResult('Add movement to shift', 'POST', '/cash-register/shifts/:id/movements', res, Boolean(res.data?.movement?.id));
  }

  if (createdShiftId) {
    const res = await request(`/cash-register/shifts/${createdShiftId}/close`, {
      method: 'POST',
      body: JSON.stringify({
        actualCash: 335.5,
        notes: 'Arqueo de caja cuadrado a la perfección',
      }),
    });
    recordResult('Close cash register shift', 'POST', '/cash-register/shifts/:id/close', res, res.data?.status === 'CLOSED');
  }

  {
    const res = await request(`/cash-register/shifts/${posStoreId}/history`);
    recordResult('Get shift history for store', 'GET', `/cash-register/shifts/:storeId/history`, res, Array.isArray(res.data));
  }

  // -----------------------------------------------------------------
  // 10. UPLOAD MODULE
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- 10. Upload Module Endpoints ---\x1b[0m');
  // 1x1 transparent PNG base64
  const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  {
    const res = await request('/upload/image', {
      method: 'POST',
      body: JSON.stringify({
        base64Data: sampleBase64,
        fileName: 'test-icon.png',
        folder: 'products',
      }),
    });
    recordResult('Upload single base64 image', 'POST', '/upload/image', res, Boolean(res.data?.url), `[URL: ${res.data?.url}]`);
  }

  {
    const res = await request('/upload/batch', {
      method: 'POST',
      body: JSON.stringify({
        images: [
          {
            base64Data: sampleBase64,
            fileName: 'batch-1.png',
            folder: 'banners',
          },
          {
            base64Data: sampleBase64,
            fileName: 'batch-2.png',
            folder: 'stores',
          },
        ],
      }),
    });
    recordResult('Upload batch base64 images', 'POST', '/upload/batch', res, Boolean(res.data?.total === 2 && Array.isArray(res.data?.images)));
  }

  // -----------------------------------------------------------------
  // 9. SUPER ADMIN & CONFIGURACIÓN DE MÉTODOS DE PAGO
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- 9. Super Admin & Pasarelas de Pago Bolivia ---\x1b[0m');

  // 9.1 Stats globales
  const resAdminStats = await request('/admin/stats');
  recordResult('Admin stats overview', 'GET', '/admin/stats', resAdminStats, Boolean(resAdminStats.data && resAdminStats.data.totalStores !== undefined));

  // 9.2 Tiendas Admin
  const resAdminStores = await request('/admin/stores');
  recordResult('Admin list all stores', 'GET', '/admin/stores', resAdminStores, Array.isArray(resAdminStores.data));

  let testAdminStoreId = null;
  if (Array.isArray(resAdminStores.data) && resAdminStores.data.length > 0) {
    testAdminStoreId = resAdminStores.data[0].id;
    // Cortar / Suspender tienda
    const resSuspend = await request(`/admin/stores/${testAdminStoreId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'SUSPENDED' }),
    });
    recordResult('Admin suspend/cut store', 'PATCH', '/admin/stores/:id/status', resSuspend, resSuspend.data?.status === 'SUSPENDED');

    // Reactivar tienda
    const resReactivate = await request(`/admin/stores/${testAdminStoreId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    recordResult('Admin reactivate store', 'PATCH', '/admin/stores/:id/status', resReactivate, resReactivate.data?.status === 'ACTIVE');
  }

  // 9.3 Usuarios Admin
  const resAdminUsers = await request('/admin/users');
  recordResult('Admin list all users', 'GET', '/admin/users', resAdminUsers, Array.isArray(resAdminUsers.data));

  if (Array.isArray(resAdminUsers.data) && resAdminUsers.data.length > 0) {
    const testUserId = resAdminUsers.data[0].id;
    const resRole = await request(`/admin/users/${testUserId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'ADMIN' }),
    });
    recordResult('Admin promote user role', 'PATCH', '/admin/users/:id/role', resRole, resRole.data?.role === 'ADMIN');
  }

  // 9.4 Pedidos Globales Admin
  const resAdminOrders = await request('/admin/orders');
  recordResult('Admin list global orders', 'GET', '/admin/orders', resAdminOrders, Array.isArray(resAdminOrders.data));

  // 9.5 Catálogo Admin & Moderación
  const resAdminProducts = await request('/admin/products');
  recordResult('Admin list all products', 'GET', '/admin/products', resAdminProducts, Array.isArray(resAdminProducts.data));

  if (createdProductId) {
    const resMod = await request(`/admin/products/${createdProductId}/moderate`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'REMOVED_BY_ADMIN' }),
    });
    recordResult('Admin moderate/take down product', 'PATCH', '/admin/products/:id/moderate', resMod, resMod.data?.status === 'REMOVED_BY_ADMIN');

    // Reactivar
    await request(`/admin/products/${createdProductId}/moderate`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
  }

  // 9.6 Pasarelas de Pago Bolivia
  const resPaymentConfigs = await request('/admin/payment-configs');
  recordResult('Admin get payment configs (QR Simple & COD)', 'GET', '/admin/payment-configs', resPaymentConfigs, Array.isArray(resPaymentConfigs.data) && resPaymentConfigs.data.length > 0);

  const resUpdateQr = await request('/admin/payment-configs/QR_SIMPLE_ASFI', {
    method: 'PUT',
    body: JSON.stringify({
      isEnabled: true,
      platformCommission: 5.5,
      notes: 'Pasarela ASFI actualizada por prueba automatizada',
    }),
  });
  recordResult('Admin update QR Simple gateway config', 'PUT', '/admin/payment-configs/QR_SIMPLE_ASFI', resUpdateQr, resUpdateQr.data?.platformCommission === 5.5);

  // -----------------------------------------------------------------
  // CLEANUP TEST PRODUCT (Tests DELETE endpoint)
  // -----------------------------------------------------------------
  console.log('\n\x1b[34m--- Cleanup & DELETE Endpoint ---\x1b[0m');
  if (createdProductId) {
    const res = await request(`/products/${createdProductId}`, {
      method: 'DELETE',
    });
    recordResult('Delete product (DELETE)', 'DELETE', `/products/:id`, res, res.data?.success === true);
  }

  // -----------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------
  console.log('\n===============================================================');
  console.log('📊 RESUMEN FINAL DE PRUEBAS DE ENDPOINTS:');
  console.log(`Total probados: ${passed + failed}`);
  console.log(`\x1b[32mExitosos (PASS): ${passed}\x1b[0m`);
  if (failed > 0) {
    console.log(`\x1b[31mFallidos (FAIL): ${failed}\x1b[0m`);
  } else {
    console.log(`\x1b[32m¡100% de los endpoints operativos y pasando sin errores!\x1b[0m`);
  }
  console.log('===============================================================\n');

  return { passed, failed, total: passed + failed, results };
}

runAllTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
