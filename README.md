# AtiendeYA

Chatbot de WhatsApp con IA para pequeños negocios en San Pedro Sula, Honduras.

## Qué hace este bot

Cuando un cliente le escribe al WhatsApp del negocio, el bot responde automáticamente 24/7 usando inteligencia artificial. Puede:
- Dar información de precios, horarios y ubicación
- Mostrar FOTOS de productos del catálogo (versión joyería)
- Tomar pedidos o agendar citas
- Recordar el contexto de la conversación
- Escalar al dueño cuando hace falta

## Archivos importantes

- **`index.js`** — el código del bot (no tocar a menos que sepás qué hacés)
- **`business.json`** — la info del negocio y el catálogo de productos — este es el que se edita para cada cliente nuevo
- **`fotos/`** — las fotos de cada producto, nombradas `001.jpg`, `002.jpg`, etc.
- **`package.json`** — las librerías que usa el bot

## Cómo agregar un producto nuevo al catálogo (versión joyería)

1. Subí la foto a la carpeta `fotos/` en GitHub, nombrala con el siguiente número disponible (ej: `019.jpg`)
2. En `business.json`, agregá un bloque nuevo dentro de `"productos"`:
   ```json
   {
     "id": "019",
     "nombre": "Nombre de la pieza",
     "precio": 900,
     "material": "Plata",
     "descripcion": "Descripción corta",
     "imagen": "https://raw.githubusercontent.com/calderageorge5-prog/Atiendeya/main/fotos/019.jpg"
   }
   ```
3. Guardá — Railway actualiza el bot solo en 1-2 minutos

## ⚠️ Pendientes antes de usar con clientes reales

Estos campos en `business.json` tienen datos de ejemplo — hay que completarlos con la info real de la tienda antes de lanzar en serio:
- `horario`
- `telefono`
- `formas_pago` — el link de pago real y los datos de la cuenta para transferencias
- Todos los `precio` están marcados como precios de PRUEBA — hay que confirmarlos con la dueña

## Variables de entorno necesarias

Para que el bot funcione hay que configurar estas variables en Railway:

- `ANTHROPIC_API_KEY` — llave de la cuenta de Anthropic (empieza con `sk-ant-`)
- `TWILIO_ACCOUNT_SID` — de la cuenta de Twilio (empieza con `AC`)
- `TWILIO_AUTH_TOKEN` — de la cuenta de Twilio

## Cómo agregar un cliente nuevo

1. Editar `business.json` con la info del negocio nuevo
2. Guardar y Railway lo actualiza solo

Para múltiples clientes con un solo bot, hay que expandir el código — Claude ayuda con eso cuando llegue el momento.
