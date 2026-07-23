// AtiendeYA - Chatbot de WhatsApp con IA para Dor Jewelry Galeano
// Recibe mensajes de WhatsApp (vía Twilio), los procesa con Claude, y responde con texto Y fotos.

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import twilio from 'twilio';
import { readFileSync } from 'fs';

const app = express();
app.use(express.urlencoded({ extended: true }));

// Cargar el catálogo del negocio desde business.json
const business = JSON.parse(readFileSync('./business.json', 'utf-8'));

// Conectar con Claude (la IA que responde)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Memoria de conversaciones (por número de teléfono)
const conversations = new Map();

// Instrucciones que le damos a Claude para que actúe como la joyería
function buildSystemPrompt(business) {
  const productList = business.productos
    .map(p => `- ID:${p.id} | ${p.nombre} | L${p.precio} | ${p.material} | ${p.descripcion}`)
    .join('\n');

  return `Sos el asistente virtual de WhatsApp de ${business.nombre}, una joyería en San Pedro Sula, Honduras.

INFORMACIÓN DEL NEGOCIO:
- Nombre: ${business.nombre}
- Retiro en tienda: ${business.direccion_retiro}
- Horario: ${business.horario}
- Teléfono: ${business.telefono}
- Todo el catálogo es de: ${business.material_general}

FORMAS DE PAGO:
${business.formas_pago.map(f => `- ${f}`).join('\n')}

${business.info_extra}

CATÁLOGO DE PRODUCTOS:
${productList}

CÓMO MOSTRAR FOTOS:
Cuando quieras mostrarle al cliente la foto de un producto, escribí la etiqueta {{IMG:id}} en tu respuesta (ejemplo: {{IMG:003}}). El sistema la reemplaza automáticamente por la foto real enviada por WhatsApp. Podés incluir varias etiquetas en una misma respuesta si vas a mostrar varios productos.

REGLAS DE COMPORTAMIENTO:
- Respondé en español hondureño, tono amable, cercano y elegante (es una joyería)
- Cuando el cliente pregunte por un tipo de producto (aretes, anillos, brazaletes), mostrale 2-4 opciones relevantes usando {{IMG:id}} para cada una
- Siempre decí el nombre y precio de cada pieza que mostrés
- Si el cliente quiere comprar, tomá su nombre y qué producto quiere, y preguntale qué forma de pago prefiere (link de pago, transferencia, o retiro en tienda)
- Recordá: todo el catálogo es de plata — si preguntan por oro, aclará amablemente que por ahora el catálogo es de plata
- Sé breve en el texto — 1-3 oraciones además de las etiquetas de fotos
- No inventés productos, precios ni materiales que no estén en el catálogo de arriba
- Usá Lempiras (L) para todos los precios
- Emojis con moderación, uno o dos por mensaje está bien (✨💍)`;
}

// Este es el "webhook" - la puerta que Twilio toca cuando llega un WhatsApp
app.post('/webhook/whatsapp', async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body;

  console.log(`📩 Mensaje de ${from}: ${message}`);

  try {
    if (!conversations.has(from)) {
      conversations.set(from, []);
    }
    const history = conversations.get(from);

    history.push({ role: 'user', content: message });
    const recentHistory = history.slice(-20);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: buildSystemPrompt(business),
      messages: recentHistory,
    });

    const rawReply = response.content[0].text;
    history.push({ role: 'assistant', content: rawReply });

    console.log(`🤖 Respuesta cruda: ${rawReply}`);

    // Buscar etiquetas {{IMG:id}} en la respuesta
    const imgTags = [...rawReply.matchAll(/\{\{IMG:(\w+)\}\}/g)].map(m => m[1]);
    const textOnly = rawReply.replace(/\{\{IMG:\w+\}\}/g, '').trim();

    const twiml = new twilio.twiml.MessagingResponse();

    // Mandar el texto primero (si queda algo después de quitar las etiquetas)
    if (textOnly) {
      twiml.message(textOnly);
    }

    // Mandar una foto por cada etiqueta encontrada, con su nombre y precio
    for (const imgId of imgTags) {
      const product = business.productos.find(p => p.id === imgId);
      if (product) {
        const msg = twiml.message(`${product.nombre} — L${product.precio}`);
        msg.media(product.imagen);
      }
    }

    // Si por algún motivo no hubo texto ni fotos, mandar la respuesta cruda igual
    if (!textOnly && imgTags.length === 0) {
      twiml.message(rawReply);
    }

    res.type('text/xml').send(twiml.toString());

  } catch (error) {
    console.error('❌ Error:', error);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Disculpá, tuve un problemita. Intentá de nuevo en un momento.');
    res.type('text/xml').send(twiml.toString());
  }
});

// Ruta simple para verificar que el bot está prendido
app.get('/', (req, res) => {
  res.send(`✅ AtiendeYA funcionando — ${business.nombre} (${business.productos.length} productos en catálogo)`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 AtiendeYA corriendo en puerto ${PORT}`);
  console.log(`   Negocio configurado: ${business.nombre}`);
  console.log(`   Productos en catálogo: ${business.productos.length}`);
});
