# Vitrina MCP

Servidor MCP para que Claude, ChatGPT o Gemini se comuniquen con Vitrina Market.

- **Sin cuenta** (cualquiera): buscar productos, ofertas, categorías, tiendas y lives.
- **Con cuenta** (inicio de sesión OAuth con el celular, código por WhatsApp): comprar y administrar la propia tienda.

Cada persona solo puede tocar lo suyo: el backend sigue validando que la tienda, el producto o el pedido sean de esa cuenta. El MCP nunca acepta claves de administración.

## Herramientas

| Quién | Herramienta | Qué hace |
|---|---|---|
| Todos | `search_products`, `get_product`, `list_deals`, `list_categories`, `list_stores`, `get_store` | Consultar el catálogo |
| Todos | `live_now` | Lives: tiendas registradas primero; si no hay, los del scraper |
| Cliente | `whoami`, `quote_delivery`, `place_order`, `my_orders`, `get_order` | Cotizar envío, pedir y seguir pedidos |
| Vendedor | `my_store`, `store_orders`, `store_summary`, `my_offers` | Ver su tienda, pedidos y ventas |
| Vendedor | `create_product`, `update_product`, `delete_product`, `adjust_stock`, `update_offer`, `create_flash_deal`, `end_deals`, `update_store`, `request_courier` | Publicar y gestionar |

Salvaguardas: `place_order`, `delete_product` y `request_courier` exigen `confirmed: true` (el asistente debe mostrar el resumen y pedir confirmación). Los cobros (QR, cuentas bancarias) no se pueden ver ni cambiar desde el MCP. Un asistente que no ha iniciado sesión recibe un 401 al usar una herramienta de cuenta, y el cliente abre la pantalla de entrada.

## Ejecutar

```bash
cd mcp
cp .env.example .env   # ajusta MARKETPLACE_API_URL y MARKETPLACE_WEB_URL
npm install && npm run build
npm start              # HTTP en :4100/mcp
npm run start:stdio    # o por stdio, para uso local
```

Despliegue: `mcp/Dockerfile` (por ejemplo como un segundo servicio en Railway). Variables: ver `.env.example`. Para activar cuentas define `MCP_PUBLIC_URL`, `MCP_SECRET` y `AUTH_INTERNAL_KEY` (la misma que usa el backend: con ella el MCP actúa como servidor de confianza, igual que la web). Sin ellas funciona en solo lectura.

## Conectarlo

ChatGPT y Claude (web) necesitan una URL **HTTPS pública**: `https://tu-mcp.up.railway.app/mcp`.

- **Claude**: Ajustes → Conectores → Añadir conector personalizado, pega la URL.
  Claude Code: `claude mcp add --transport http vitrina https://tu-mcp.up.railway.app/mcp`
- **ChatGPT**: Ajustes → Conectores → modo desarrollador → crear conector con esa URL.
- **Gemini CLI** (`~/.gemini/settings.json`):
  ```json
  { "mcpServers": { "vitrina": { "httpUrl": "https://tu-mcp.up.railway.app/mcp" } } }
  ```
- **Local por stdio** (Claude Desktop, etc.): `{ "command": "node", "args": ["<ruta>/mcp/dist/stdio.js"], "env": { "MARKETPLACE_API_URL": "...", "MARKETPLACE_WEB_URL": "..." } }`

Al usar una herramienta de cuenta, el asistente muestra el botón de entrar: el cliente escribe su celular, recibe el código por WhatsApp y da permiso. Las sesiones duran 1 hora y se renuevan solas hasta 30 días.

Limitaciones: las sesiones están firmadas y no se guardan en base de datos, así que "cerrar sesión" no las invalida antes de vencer, y la protección contra reuso de códigos vive en memoria (corre una sola instancia). Para rotar todo, cambia `MCP_SECRET`.
