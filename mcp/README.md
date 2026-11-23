# Vitrina MCP

Servidor MCP **de solo lectura** para que Claude, ChatGPT o Gemini consulten Vitrina Market: productos, ofertas, categorías, tiendas y lives. No compra ni crea pedidos: devuelve el enlace del producto para que el cliente termine en Vitrina.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `search_products` | Busca por texto, categoría y precio máximo |
| `get_product` | Detalle y ofertas por tienda |
| `list_deals` | Descuentos activos |
| `list_categories` | Categorías (incluye Licorerías) |
| `list_stores` / `get_store` | Tiendas y lo que venden |
| `live_now` | Lives: tiendas registradas primero; si no hay, los del scraper |

Solo se exponen datos públicos. Nunca salen QR de cobro, cuentas bancarias, teléfonos, dueños ni datos de pedidos (el seguimiento por código no está incluido a propósito: trae la dirección del cliente).

## Ejecutar

```bash
cd mcp
cp .env.example .env   # ajusta MARKETPLACE_API_URL y MARKETPLACE_WEB_URL
npm install && npm run build
npm start              # HTTP en :4100/mcp
npm run start:stdio    # o por stdio, para uso local
```

Despliegue: `mcp/Dockerfile` (por ejemplo como un segundo servicio en Railway). Variables: `MARKETPLACE_API_URL`, `MARKETPLACE_WEB_URL`, `MCP_API_KEY` (opcional) y `PORT`.

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

Si pones `MCP_API_KEY`, el cliente debe enviar `Authorization: Bearer <clave>`. Algunos conectores web solo aceptan OAuth o ninguna clave; como los datos son públicos, puedes dejarla vacía.
