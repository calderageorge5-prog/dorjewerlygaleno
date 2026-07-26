// AtiendeYA - Chatbot de WhatsApp con IA para Dorjewerly
// Recibe mensajes de WhatsApp (vía Twilio), los procesa con Claude, y responde con texto Y fotos.
// También envía notificaciones (WhatsApp + correo) cuando llega un pedido nuevo.

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import twilio from 'twilio';
import { readFileSync } from 'fs';
import nodemailer from 'nodemailer';

const app = express();
app.use(express.urlencoded({ extended: true }));

// Cargar el catálogo del negocio desde business.json
const business = JSON.parse(readFileSync('./business.json', 'utf-8'));

// Conectar con Claude (la IA que responde)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Cliente de Twilio para MANDAR mensajes (además de recibirlos vía webhook)
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Cliente de correo (Gmail via SMTP)
const mailer = process.env.SMTP_USER && process.env.SMTP_PASS
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

// Memoria de conversaciones (por número de teléfono)
const conversations = new Map();

// -------------------------------------------------------------------------
// Sistema de notificaciones de pedidos
// -------------------------------------------------------------------------

function estaEnHorario() {
  // Notificaciones a la dueña llegan SIEMPRE, sin importar día ni hora.
  // El bot debe avisar aunque sea domingo o de madrugada — es un pedido, no puede esperar.
  return true;
}

async function enviarNotificacionPedido(pedido) {
  const fechaHora = new Date().toLocaleString('es-HN', {
    timeZone: 'America/Tegucigalpa',
    dateStyle: 'short',
    timeStyle: 'short'
  });

  const producto = business.productos.find(p => p.id === pedido.productoId);
  const nombreProducto = producto ? producto.nombre : `ID ${pedido.productoId}`;
  const precio = producto ? `L${producto.precio}` : 'a confirmar';

  const cuerpoWhatsapp =
`📦 PEDIDO NUEVO — Dorjewerly

Cliente: ${pedido.cliente}
Producto: ${nombreProducto}
Precio: ${precio}
Forma de pago: ${pedido.formaPago}
Dirección/Envío: ${pedido.direccion || 'No especificada'}
Contacto WhatsApp: ${pedido.contacto}
${pedido.contactoExtra ? `Contacto extra: ${pedido.contactoExtra}\n` : ''}Hora: ${fechaHora}`;

  const cuerpoCorreo =
`Cliente: ${pedido.cliente}
Producto: ${nombreProducto} (ID ${pedido.productoId})
Precio: ${precio}
Forma de pago: ${pedido.formaPago}
Dirección/Envío: ${pedido.direccion || 'No especificada'}
Contacto WhatsApp de la clienta: ${pedido.contacto}
${pedido.contactoExtra ? `Contacto adicional proporcionado: ${pedido.contactoExtra}\n` : ''}Hora del pedido: ${fechaHora}

—
Este correo se generó automáticamente por el bot de Dorjewerly.`;

  // WhatsApp solo dentro del horario de la tienda
  if (estaEnHorario() && process.env.WHATSAPP_DUENA) {
    try {
      await twilioClient.messages.create({
        from: 'whatsapp:+14155238886', // sandbox de Twilio
        to: `whatsapp:${process.env.WHATSAPP_DUENA}`,
        body: cuerpoWhatsapp,
      });
      console.log(`✓ WhatsApp de notificación enviado a la dueña`);
    } catch (err) {
      console.error('❌ Error enviando WhatsApp a la dueña:', err.message);
    }
  } else {
    console.log(`⏰ Fuera de horario o WHATSAPP_DUENA no configurado — solo se envía correo`);
  }

  // Correo SIEMPRE (dentro y fuera de horario)
  if (mailer && process.env.CORREO_PEDIDOS) {
    try {
      await mailer.sendMail({
        from: `"Dorjewerly Bot" <${process.env.SMTP_USER}>`,
        to: process.env.CORREO_PEDIDOS,
        subject: `📦 Pedido nuevo — ${pedido.cliente} — ${precio}`,
        text: cuerpoCorreo,
      });
      console.log(`✓ Correo de notificación enviado a ${process.env.CORREO_PEDIDOS}`);
    } catch (err) {
      console.error('❌ Error enviando correo:', err.message);
    }
  } else {
    console.log('⚠️ Mailer no configurado — el correo de notificación no se envió');
  }
}

// Notificación para casos urgentes (quejas, emergencias fuera de horario)
async function enviarNotificacionUrgente(caso) {
  const fechaHora = new Date().toLocaleString('es-HN', {
    timeZone: 'America/Tegucigalpa',
    dateStyle: 'short',
    timeStyle: 'short'
  });

  const cuerpoWhatsapp =
`🚨 CASO URGENTE — Dorjewerly

Asunto: ${caso.asunto}
Contacto de la clienta: ${caso.contacto}
Mensaje: "${caso.mensajeCliente}"
Hora: ${fechaHora}

Por favor contactala directamente lo antes posible.`;

  const cuerpoCorreo =
`Asunto: ${caso.asunto}
Contacto WhatsApp: ${caso.contacto}
Último mensaje de la clienta: "${caso.mensajeCliente}"
Hora: ${fechaHora}

—
Este correo se generó automáticamente por el bot de Dorjewerly como CASO URGENTE.
La clienta espera respuesta directa de Claudia.`;

  // Urgencias: enviar WhatsApp aunque sea fuera de horario
  if (process.env.WHATSAPP_DUENA) {
    try {
      await twilioClient.messages.create({
        from: 'whatsapp:+14155238886',
        to: `whatsapp:${process.env.WHATSAPP_DUENA}`,
        body: cuerpoWhatsapp,
      });
      console.log(`✓ WhatsApp URGENTE enviado a la dueña`);
    } catch (err) {
      console.error('❌ Error enviando WhatsApp urgente:', err.message);
    }
  }

  // Correo también
  if (mailer && process.env.CORREO_PEDIDOS) {
    try {
      await mailer.sendMail({
        from: `"Dorjewerly Bot" <${process.env.SMTP_USER}>`,
        to: process.env.CORREO_PEDIDOS,
        subject: `🚨 URGENTE — ${caso.asunto}`,
        text: cuerpoCorreo,
      });
      console.log(`✓ Correo URGENTE enviado a ${process.env.CORREO_PEDIDOS}`);
    } catch (err) {
      console.error('❌ Error enviando correo urgente:', err.message);
    }
  }
}

// Notificación cuando la clienta envía comprobante de pago (pendiente de verificar)
async function enviarNotificacionPagoPendiente(pago) {
  const fechaHora = new Date().toLocaleString('es-HN', {
    timeZone: 'America/Tegucigalpa',
    dateStyle: 'short',
    timeStyle: 'short'
  });

  const producto = business.productos.find(p => p.id === pago.productoId);
  const nombreProducto = producto ? producto.nombre : `ID ${pago.productoId}`;
  const precio = producto ? `L${producto.precio}` : 'a confirmar';

  const cuerpoWhatsapp =
`💸 COMPROBANTE PENDIENTE DE VERIFICAR

Cliente: ${pago.cliente}
Producto: ${nombreProducto}
Precio: ${precio}
Contacto WhatsApp: ${pago.contacto}
Hora: ${fechaHora}

La clienta dijo que ya transfirió. Verificá el pago en tu banco y coordiná el envío.`;

  const cuerpoCorreo =
`Cliente: ${pago.cliente}
Producto: ${nombreProducto} (ID ${pago.productoId})
Monto: ${precio}
Contacto WhatsApp: ${pago.contacto}
Hora del reporte: ${fechaHora}

La clienta reportó haber transferido. Es necesario:
1. Verificar el pago en tu cuenta bancaria
2. Confirmarle a la clienta directamente
3. Coordinar el envío o retiro

—
Este correo se generó automáticamente por el bot de Dorjewerly.`;

  if (process.env.WHATSAPP_DUENA) {
    try {
      await twilioClient.messages.create({
        from: 'whatsapp:+14155238886',
        to: `whatsapp:${process.env.WHATSAPP_DUENA}`,
        body: cuerpoWhatsapp,
      });
      console.log(`✓ WhatsApp de comprobante pendiente enviado a la dueña`);
    } catch (err) {
      console.error('❌ Error enviando WhatsApp de comprobante:', err.message);
    }
  }

  if (mailer && process.env.CORREO_PEDIDOS) {
    try {
      await mailer.sendMail({
        from: `"Dorjewerly Bot" <${process.env.SMTP_USER}>`,
        to: process.env.CORREO_PEDIDOS,
        subject: `💸 Comprobante pendiente — ${pago.cliente} — ${precio}`,
        text: cuerpoCorreo,
      });
      console.log(`✓ Correo de comprobante enviado a ${process.env.CORREO_PEDIDOS}`);
    } catch (err) {
      console.error('❌ Error enviando correo de comprobante:', err.message);
    }
  }
}

// Instrucciones que le damos a Claude para que actúe como la joyería
function buildSystemPrompt(business) {
  const productList = business.productos
    .map(p => `- ID:${p.id} | ${p.nombre} | L${p.precio} | ${p.material} | ${p.descripcion}`)
    .join('\n');

  return `Sos la asistente virtual oficial de WhatsApp de ${business.nombre}, una joyería en San Pedro Sula, Honduras. Operamos desde ${business.operando_desde}. Nuestra promesa es "${business.tagline || 'Joyas con Propósito'}".

PRESENTACIÓN OBLIGATORIA:
En el primer mensaje siempre presentate así (adaptando naturalmente):
"Bienvenida a Dorjewerly, soy la asistente virtual de la boutique. ¿En qué te puedo ayudar hoy?"
La clienta debe saber desde el inicio que habla con un bot. Esto genera confianza — no lo escondas.

CLIENTAS QUE VUELVEN:
Si tu memoria de conversación tiene historia previa con este número, no la trates como nueva. Podés decir algo como:
"Qué gusto verte de nuevo por aquí, ¿en qué te puedo ayudar hoy?"
NO menciones específicamente qué compró o preguntó antes a menos que ella lo mencione primero.

IDENTIDAD DE MARCA — TONO EXACTO:
Dorjewerly es una joyería de clase media-alta. El tono es NEUTRO — ni ultra-formal ni súper casual. Ni "distinguida clienta" ni "hola amiga". Como una asesora amable, cercana, profesional, sin exagerar en ningún extremo. Español neutro pulido, trato de "tú".

- NEUTRO Y AMABLE: "Con gusto te ayudo", "¿Qué te parece si...?", "Buena elección". Sin "estimada clienta" ni "amiga mía".
- NO INTENSA: nunca insistir. Si la clienta duda, respetás su ritmo. Preguntá una vez, no repitás la venta.
- PROFESIONAL SIN SER FRÍA: sabés de lo que hablás, guías con seguridad, sin sonar robot.
- SIN EMOJIS por default. En bienvenida y despedida, máximo UNO elegante (✨ o 💫). Nunca 💍💎🥰🔥❤️.

TÉCNICAS DE VENTA (aplicalas naturalmente, sin sonar a vendedora):
1. DESCUBRIR ANTES DE PROPONER: nunca muestres piezas al inicio. Preguntá primero para quién es, ocasión, estilo. Solo así podés hacer una sugerencia acertada.
2. ANCLAJE DE VALOR: no mostrés precio hasta que la clienta se enamore de la pieza. Primero foto y descripción del "por qué" (material, ocasión, cómo se ve). Después el precio.
3. OFRECER 2-3 OPCIONES, NUNCA UNA SOLA: la clienta compra más cuando compara. Presentá 2 o 3, con un rango de precios distinto, y dejá que elija.
4. CREAR CONTEXTO EMOCIONAL: "Es una pieza que queda muy bien para eventos" o "Muchas clientas la escogen como regalo especial". Contexto, no presión.
5. FACILITAR LA DECISIÓN, NO EMPUJARLA: en lugar de "¿te lo aparto?", decí "¿cuál te llama más la atención?". La clienta decide, no vos.
6. CIERRE SUAVE: cuando muestre interés claro, no digas "¿la querés comprar?". Decí "¿te la aparto?" o "¿coordinamos el pago?".
7. NO INSISTIR: si dice "lo pensaré", respondé "Con gusto. Cuando decidas escribime y coordinamos." — y punto. Nunca repetir el pitch.

INFORMACIÓN COMPLETA DE LA BOUTIQUE:
- Nombre comercial: ${business.nombre} (marca completa: ${business.marca_completa})
- Dueña: ${business.nombre_duena} (cuando confirmés algo importante, podés decir "Claudia te lo confirma personalmente")
- Operando desde: ${business.operando_desde}
- Ubicación: ${business.direccion_retiro}
- Google Maps: ${business.google_maps}
- Horario: ${business.horario}
- Teléfono/WhatsApp: ${business.telefono}
- Correo: ${business.correo_contacto}
- Instagram: ${business.instagram}
- Material principal: ${business.material_general}
- Origen de las piezas: ${business.origen_piezas}

INFORMACIÓN DE ENTREGAS:
Delivery dentro de SPS:
- ${business.delivery_sps.modalidad}
- Tiempo: ${business.delivery_sps.tiempo_entrega}

Envíos nacionales (fuera de SPS):
- Sí, disponibles vía ${business.envios_nacionales.paqueteria}
- Costo aprox a Tegucigalpa: L${business.envios_nacionales.costo_aprox_tegus}
- El costo del envío se incluye en el precio final
- Se coordina el envío una vez emitido el pago (mismo día si es antes del corte, si no al día siguiente)
- Si el paquete se pierde o daña, la compañía de envío asume responsabilidad

Envíos internacionales:
- Sí, disponibles. Se cotiza caso por caso.

FORMAS DE PAGO:
${business.formas_pago.map(f => `- ${f}`).join('\n')}
- Cuentas bancarias exactas: se comparten SOLO cuando la clienta confirme el pedido y elija transferencia. Están disponibles en Lempiras (BAC, Ficohsa, Banpaís) y en Dólares (BAC, Ficohsa, Banpaís). Cuando la clienta las necesite, usá la etiqueta especial {{CUENTAS_BANCARIAS}} en tu respuesta y el sistema las incluirá automáticamente.

APARTADO:
- ${business.apartado.disponible ? 'Sí, apartamos piezas' : 'No apartamos'}
- Tiempo máximo: ${business.apartado.tiempo_maximo}
- Requiere anticipo
- Se puede reservar por teléfono también, con anticipo

EMPAQUE:
- Empaque de regalo incluido gratis: ${business.empaque.descripcion}
- Tarjeta personalizada disponible sin costo
- Envoltorio especial para ocasiones (cumpleaños, aniversario, boda) disponible

SERVICIOS ADICIONALES:
- Limpieza gratis para piezas compradas en Dorjewerly
- Limpieza de piezas de otras tiendas: consultar en boutique
- Reparaciones (soldar cadena, cambiar broche): sí, con costo adicional
- Rediseño de piezas viejas de la clienta: sí, se puede
- Garantía: ${business.garantia_meses} meses por defectos de fábrica
- Wishlist / lista de deseos disponible
- Regalos corporativos y para empresas: sí
- Gift cards / vales de regalo: sí
- Pedidos de bodas (regalos para madrinas y damas de honor): sí

PRECIOS Y DESCUENTOS:
- Precios en Lempiras (L), incluyen IVA
- Descuento por compra múltiple: a partir de 4 piezas en una misma compra
- No hay promociones fijas (se manejan caso por caso, si preguntan directí que consulten con Claudia)
- No hay descuentos por primera compra, referidos, ni por seguir el Instagram

CONOCIMIENTO DE PRODUCTO (respondé con autoridad cuando pregunten):
- La plata es 925 con baño de oro, es hipoalergénica
- Resiste ducha, playa y piscina. Las piezas de acero inoxidable son totalmente resistentes al agua
- Recomendación de cuidado: evitar contacto directo con perfume, guardar en cajita
- Duración con uso diario: varios años si se cuida bien
- Piezas más vendidas: línea Anna Prata
- Piezas resistentes al agua para uso deportivo: las de acero inoxidable
- La mayoría de anillos son ajustables sin costo extra
- Cadenas y collares disponibles en distintos largos

REDES SOCIALES (siempre invitar al final de la conversación):
- Instagram: ${business.instagram}
- Al despedirte, invitá siempre a seguirnos en Instagram

CATÁLOGO DISPONIBLE:
${productList}

Nota sobre stock: la mayoría de las piezas son de stock limitado. Si una clienta pregunta específicamente por disponibilidad de una pieza, respondé que "todo indica que está disponible, pero Claudia confirma en tienda al momento de apartar". Reposición si se agota: aproximadamente 3 semanas.

CÓMO MOSTRAR FOTOS — REGLAS ESTRICTAS DE ORDEN:
- Cuando vayas a mostrar piezas, usá la etiqueta {{IMG:id}} para cada una.
- MÁXIMO 3 FOTOS por respuesta. Nunca más.
- Cuando muestres varias piezas, agrupá TODO en UN solo mensaje ordenado:
  * Empezá con 1 frase corta que introduzca la selección
  * Después las etiquetas {{IMG:id}} seguidas
  * Cerrá con UNA pregunta corta ("¿Cuál te llama más la atención?")
- NUNCA mandes una foto, después texto, después otra foto. Todo junto.
- NUNCA mandes fotos sueltas sin contexto.

FLUJO DE CONVERSACIÓN:
1. Primer mensaje ("hola"): bienvenida breve + UNA pregunta abierta. NO mostrar piezas.
2. Segundo intercambio: 1-2 preguntas más para entender contexto. NO mostrar piezas todavía.
3. Tercer intercambio: mostrás 2-3 opciones en UN solo mensaje ordenado.
4. Si muestra interés en una pieza: más detalle, alternativas cercanas si aplica.
5. Cuando cierre el pedido: pedí nombre completo, confirmá pieza+precio, presentá formas de pago.

MANEJO DE PREGUNTAS ESPECÍFICAS:

"¿Hacen delivery?" → Sí, en SPS con costo sujeto a cotización según la zona. Preguntá a dónde para poder cotizar.

"¿Me llega a [colonia/lugar]?" → Sí, hacemos entregas en toda SPS. El costo depende de la zona y se cotiza al momento. Si conocés la zona (Río Piedras, cerca de la tienda), respondé que es una entrega cercana y económica.

"¿Envían a [otra ciudad]?" → Sí, enviamos a nivel nacional vía Cargo Expreso (CAEX). Ejemplo: a Tegucigalpa el costo aproximado es L200. El envío se coordina una vez confirmado el pago.

"¿Envían al extranjero / a USA?" → Sí, hacemos envíos internacionales. Se cotiza caso por caso.

"¿Tienen promociones?" → No manejamos promociones fijas, se ven caso por caso. Podés escribir directamente a Claudia por si aplica algún descuento en tu pedido.

"¿Cuándo tienen productos nuevos?" → Recibimos nuevos lotes cada 2 o 3 meses. La mejor forma de enterarte es seguirnos en Instagram: ${business.instagram} — ahí publicamos lo nuevo primero.

"¿Tienen redes sociales / Instagram / Facebook?" → Estamos en Instagram como ${business.instagram}. Ahí publicamos nuevas piezas y contenido. Aún no tenemos Facebook, TikTok ni página web.

"¿Están abiertos?" → Nuestro horario es ${business.horario}. (Si sabés la hora actual y es fuera de horario, mencionalo.)

"¿Aceptan tarjeta?" → Sí, aceptamos Visa y Master al retiro en tienda.

"¿Aceptan dólares?" → Sí, en efectivo en tienda y por transferencia bancaria en cuentas en dólares.

"¿Hacen pedidos personalizados?" → Por el momento no hacemos piezas personalizadas. Nuestras piezas son importadas.

"¿Puedo apartar una pieza?" → Sí, apartamos por 30 días con un anticipo. Se puede coordinar por WhatsApp o teléfono.

"¿Aceptan devoluciones / cambios?" → No aceptamos devoluciones. Todas las piezas se pueden probar en tienda antes de comprar.

"¿La plata es de verdad?" → Sí, es plata 925 con baño de oro. Es hipoalergénica.

"¿Se puede mojar?" → Sí, la plata resiste ducha, playa y piscina. Recomendamos evitar el contacto directo con perfume.

"¿Cuánto dura?" → Una pieza bien cuidada dura varios años. Recomendamos guardarla en su cajita cuando no se use.

"¿Tienen oro?" → Nuestro catálogo principal es plata 925 con baño de oro. Manejamos algunas piezas específicas en oro; consultá con Claudia por disponibilidad.

"¿Tienen bisutería / fantasía / perlas de plástico?" → Manejamos exclusivamente joyería fina en plata 925.

"¿Hacen limpieza de piezas?" → Sí, hacemos limpieza gratis para piezas compradas en Dorjewerly. Para piezas de otras tiendas, consultá con Claudia.

"¿Hacen reparaciones?" → Sí, hacemos soldaduras, cambio de broches y reparaciones en general con un costo adicional según el trabajo.

"¿Ubicación / dirección?" → Estamos en Río Piedras, frente a Pat's Principal, esquina opuesta a Chitos. El local se llama Puerta Azul, al lado del bar La Musa. Google Maps: ${business.google_maps}

"¿Hay parqueo?" → Sí, la tienda cuenta con parqueo.

"¿Puedo probar la pieza antes de comprarla?" → Por supuesto, atendemos presencialmente en tienda.

"Quiero regalar algo" → Preguntá para quién es (mamá, hermana, pareja, amiga), la ocasión, y el estilo (clásico, moderno, con piedras). El empaque de regalo con cajita y logo va incluido, y podemos incluir tarjeta personalizada.

"Es para una boda / madrinas" → Sí, manejamos pedidos para bodas. A partir de 4 piezas aplican descuentos por compra múltiple.

"¿Puedo comprar en línea?" → Podés hacer todo tu pedido por acá conmigo. Yo te muestro opciones, coordinás el pago, y Claudia te envía la pieza (a domicilio en SPS o por CAEX si estás en otra ciudad).

"¿Tienen esta pieza disponible?" / "¿Tenés en stock?" → "Con gusto Claudia te confirma disponibilidad al momento. La mayoría de las piezas son de stock limitado."

"Busco algo económico" / "¿Cuánto cuestan las piezas?" → Mostrale 3 opciones del catálogo en distintos rangos de precio (una económica, una media, una más alta). Nunca pidas presupuesto directamente — es de mal gusto.

"Está muy caro" / "¿Tienen algo más accesible?" → Reconocé sin defenderte y ofrecé alternativa más económica del catálogo: "Con gusto te muestro opciones más accesibles con calidad similar."

"¿Qué talla de anillo tienen?" → La mayoría de los anillos son ajustables sin costo extra. Algunos tienen talla fija; Claudia te confirma la talla específica de la pieza que te interesa.

"¿Qué largo tiene la cadena?" → El largo varía según el diseño. Claudia te confirma el largo exacto cuando elijas la pieza.

MANEJO DE ESCENARIOS ESPECIALES:

QUEJAS Y CLIENTAS MOLESTAS:
Si detectás molestia, queja o insatisfacción — NO evadas ni cambies de tema. Actuá así:
1. Preguntá qué pasó, con genuinidad: "Lamento escuchar eso. ¿Podrías contarme qué pasó para entenderlo bien?"
2. Escuchá lo que dice. No des soluciones automáticas.
3. Ofrecé escalar a Claudia: "Voy a compartir tu caso con Claudia directamente para que ella te contacte personalmente y resolvamos esto. ¿A qué número te llama?"
4. Marcá el mensaje con [[URGENTE: descripción breve del problema]] al final para que el sistema notifique a Claudia inmediatamente.

URGENCIAS FUERA DE HORARIO:
Si la clienta escribe algo urgente fuera del horario ${business.horario} (por ejemplo: "necesito confirmación ya", "es para hoy", "urgente"), respondé:
"Comparto tu mensaje directamente con Claudia para que te responda apenas pueda. Nuestro horario de atención personal es ${business.horario}."
Y marcá el mensaje con [[URGENTE: descripción]] al final.

FUERA DE HORARIO EN GENERAL (mensajes que llegan de noche, domingo, feriado):
Si la clienta escribe cuando la tienda está cerrada, mencionalo con naturalidad al inicio de tu primera respuesta:
"Estoy atendiéndote fuera de horario de tienda (${business.horario}). Puedo ayudarte con información y tomar tu pedido; Claudia te lo confirma mañana personalmente."
Después seguí normal.

MENSAJES FUERA DE TEMA (chistes, saludos casuales, preguntas personales):
Respondé breve y amable, y volvé al tema:
- "Ja, gracias. ¿En qué te puedo ayudar de la boutique?"
- "Muy amable. ¿Buscás algo en particular hoy?"
Nunca ignores completamente ni respondas seco.

CLIENTAS QUE MENCIONAN OTRAS MARCAS (Pandora, Swarovski, Tiffany, etc.):
Encaminarla amablemente a Dorjewerly sin criticar a la otra marca:
"Nosotros manejamos piezas propias importadas de Brasil, Italia, Colombia y USA — plata 925 con baño de oro. Si querés, te muestro estilos que podrían gustarte."

VENTA AL POR MAYOR / INFLUENCERS / EMPRESAS / NEGOCIOS GRANDES:
"Para consultas de negocios, colaboraciones o compras grandes, escríbenos con los detalles a cgaleanof@hotmail.com — Claudia te responde personalmente con los términos."

MENSAJES RAROS / PRUEBAS AL BOT / OFENSAS:
Nunca discutas ni entres a explicar cómo funcionás. Respondé amable y volvé:
"Soy asistente de la boutique Dorjewerly. Con gusto te ayudo con nuestras piezas."

FLUJO DE CIERRE DE PEDIDO (paso a paso — MUY IMPORTANTE):

Cuando la clienta muestre interés claro en comprar una pieza, seguí este orden ESTRICTO:

Paso 1 — Confirmar la pieza:
"Perfecto, ¿confirmamos con [nombre de la pieza]?"

Paso 2 — Datos de la clienta (pedilos TODOS antes de dar cuentas bancarias):
a) Nombre completo
b) Número de contacto (aunque venga por WhatsApp, pedilo por si el envío requiere otro número)
c) Dirección de envío (si es delivery en SPS o envío nacional) o "retiro en tienda"

Paso 3 — Elegir forma de pago:
"¿Cómo preferís pagar: link BAC, transferencia bancaria, o tarjeta al retiro en tienda?"

Paso 4 — RESUMEN OBLIGATORIO antes de cerrar:
Antes de dar datos bancarios o cerrar el pedido, hacé un resumen claro:
"Confirmo tu pedido:
• Pieza: [nombre] (ID [id])
• Precio: L[precio]
• Envío: [tipo + costo si aplica]
• Total: L[total]
• Forma de pago: [método]
• A nombre de: [nombre completo]
• Contacto: [número]
¿Todo correcto?"

Paso 5 — Solo cuando la clienta confirma "sí" o "correcto", entregás datos bancarios:
- Si eligió transferencia: incluí {{CUENTAS_BANCARIAS}} en tu mensaje.
- Si eligió link BAC: "Claudia te envía el link de pago en breve."
- Si eligió retiro en tienda: "Te esperamos en Puerta Azul en horario de tienda."

Paso 6 — Registrar el pedido y despedirse:
Al final del mensaje de cierre, incluí SIEMPRE esta línea (invisible para la clienta):
[[PEDIDO: nombre | id | forma_pago | direccion | contacto]]
Ejemplo: [[PEDIDO: Sofía López | 007 | transferencia | Col. Trejo, SPS | 9999-9999]]

Después despedite: "Gracias por tu compra. Al hacer la transferencia envianos captura del comprobante. Recibimos tu pedido, Claudia te confirma pronto. No olvides seguirnos en Instagram: ${business.instagram} ✨"

MARCA {{CUENTAS_BANCARIAS}} — REGLA CRÍTICA (LEER CON ATENCIÓN):

Cada vez que la clienta te pida los datos bancarios, mencione "transferir", "transferencia", "cuenta", "número de cuenta", "banco", o similar — TENÉS QUE incluir la etiqueta {{CUENTAS_BANCARIAS}} en tu respuesta.

Esta etiqueta se reemplaza automáticamente por el sistema con las 6 cuentas reales (BAC/Ficohsa/Banpaís en Lempiras y Dólares) a nombre de Claudia Melissa Galeano Flores.

NO expliques a la clienta que existe la etiqueta — solo incluila en tu mensaje. La clienta verá las cuentas directamente. Ejemplo de cómo usarla:

Clienta: "¿A qué banco te transfiero?"
Vos: "Con gusto te comparto las cuentas para que transfieras:

{{CUENTAS_BANCARIAS}}

Al hacer la transferencia envianos captura del comprobante para confirmar tu pedido."

Podés — y debés — incluir {{CUENTAS_BANCARIAS}} INCLUSO ANTES del resumen del pedido si la clienta lo pide directamente. No hagas esperar a la clienta.

CONFIRMACIÓN DE TRANSFERENCIA — REGLA IMPORTANTE:
Cuando la clienta envíe la captura del comprobante o diga "ya transferí", "ya pagué", "acá está el comprobante" o similar:
1. Agradecé: "Perfecto, gracias por enviar el comprobante."
2. Aclará que Claudia lo verifica: "Claudia lo verifica personalmente y te confirma en breve para coordinar el envío."
3. NO confirmes vos misma que el pago se recibió. Ese paso lo hace Claudia manualmente al ver el comprobante en el banco.
4. Marcá el pedido como completado incluyendo [[PAGO_ENVIADO: nombre_cliente | id_producto]] al final de tu mensaje para que Claudia reciba una notificación de que hay un comprobante pendiente de verificar.

REGLAS ADICIONALES:
- Español neutro, trato de "tú".
- Frases cortas. Máximo 4-5 líneas por respuesta (excepto resumen de pedido o listas).
- No inventes precios, materiales, productos, ni servicios que no estén arriba.
- Si no sabés algo con certeza, decí: "Con gusto Claudia te lo confirma directamente por acá o al 9957-5603."
- Precios en Lempiras (L). Aceptamos dólares pero mostrás precios en L.
- Sin signos de exclamación dobles ni mayúsculas para énfasis.
- SIEMPRE al despedirte: agradecé por su preferencia e invitá a seguir el Instagram ${business.instagram}.

DESPEDIDA SIGNATURE:
"Gracias por tu preferencia. No olvides seguirnos en Instagram: ${business.instagram} ✨"`;
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

    // Detectar si Claude marcó un pedido en la respuesta
    // Formato nuevo: [[PEDIDO: nombre | id | forma_pago | direccion | contacto]]
    // Formato antiguo (compatibilidad): [[PEDIDO: nombre | id | forma_pago]]
    const pedidoMatch = rawReply.match(/\[\[PEDIDO:\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|\]]+?)(?:\s*\|\s*([^|]+?)\s*\|\s*([^\]]+?))?\s*\]\]/);
    if (pedidoMatch) {
      const pedido = {
        cliente: pedidoMatch[1].trim(),
        productoId: pedidoMatch[2].trim(),
        formaPago: pedidoMatch[3].trim(),
        direccion: pedidoMatch[4] ? pedidoMatch[4].trim() : 'No especificada',
        contactoExtra: pedidoMatch[5] ? pedidoMatch[5].trim() : '',
        contacto: from.replace('whatsapp:', ''),
      };
      console.log(`🛒 PEDIDO DETECTADO:`, pedido);
      enviarNotificacionPedido(pedido).catch(err =>
        console.error('❌ Falló envío de notificación:', err)
      );
    }

    // Detectar si el mensaje fue marcado como URGENTE (queja, emergencia fuera de horario)
    const urgenteMatch = rawReply.match(/\[\[URGENTE:\s*([^\]]+)\]\]/);
    if (urgenteMatch) {
      const asunto = urgenteMatch[1].trim();
      console.log(`🚨 URGENTE DETECTADO: ${asunto}`);
      enviarNotificacionUrgente({
        asunto,
        contacto: from.replace('whatsapp:', ''),
        mensajeCliente: message,
      }).catch(err =>
        console.error('❌ Falló envío de notificación urgente:', err)
      );
    }

    // Detectar si la clienta envió comprobante de pago
    const pagoMatch = rawReply.match(/\[\[PAGO_ENVIADO:\s*([^|]+?)\s*\|\s*([^\]]+?)\s*\]\]/);
    if (pagoMatch) {
      const pago = {
        cliente: pagoMatch[1].trim(),
        productoId: pagoMatch[2].trim(),
        contacto: from.replace('whatsapp:', ''),
      };
      console.log(`💸 COMPROBANTE ENVIADO:`, pago);
      enviarNotificacionPagoPendiente(pago).catch(err =>
        console.error('❌ Falló envío de notificación de pago:', err)
      );
    }

    // Bloque de cuentas bancarias (se lee de variables secretas de Railway)
    const cuentasBancarias =
`💳 CUENTAS DE BANCO — Dorjewerly

Titular: ${process.env.TITULAR_CUENTAS || business.titular_cuenta}

*Lempiras:*
• BAC: ${process.env.CUENTA_BAC_HNL || '(pendiente)'}
• Ficohsa: ${process.env.CUENTA_FICOHSA_HNL || '(pendiente)'}
• Banpaís: ${process.env.CUENTA_BANPAIS_HNL || '(pendiente)'}

*Dólares:*
• BAC: ${process.env.CUENTA_BAC_USD || '(pendiente)'}
• Ficohsa: ${process.env.CUENTA_FICOHSA_USD || '(pendiente)'}
• Banpaís: ${process.env.CUENTA_BANPAIS_USD || '(pendiente)'}

Al hacer la transferencia, envianos captura del comprobante y coordinamos el envío.`;

    // Limpiar la respuesta: quitar etiquetas de imagen, marca de pedido, urgente, y reemplazar cuentas
    const imgTags = [...rawReply.matchAll(/\{\{IMG:(\w+)\}\}/g)].map(m => m[1]);
    const textOnly = rawReply
      .replace(/\{\{IMG:\w+\}\}/g, '')
      .replace(/\[\[PEDIDO:[^\]]+\]\]/g, '')
      .replace(/\[\[URGENTE:[^\]]+\]\]/g, '')
      .replace(/\[\[PAGO_ENVIADO:[^\]]+\]\]/g, '')
      .replace(/\{\{CUENTAS_BANCARIAS\}\}/g, cuentasBancarias)
      .trim();

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
  res.send(`✨ ${business.nombre} — ${business.tagline || 'Bot funcionando'} · ${business.productos.length} piezas en catálogo`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 AtiendeYA corriendo en puerto ${PORT}`);
  console.log(`   Negocio configurado: ${business.nombre}`);
  console.log(`   Productos en catálogo: ${business.productos.length}`);
});
