# Product Spec — Service Menu App

## Cliente objetivo

Negocios locales pequeños con servicio a clientes que necesitan mostrar su oferta de forma
clara sin construir un sitio web propio:

- Salones de belleza y barberías.
- Spas y centros de wellness.
- Estudios de manicura/pedicura, masajes, estética.
- Negocios locales similares con catálogo de servicios y precios.

Perfil típico: dueño/a no técnico, ya usa WhatsApp e Instagram para vender, no tiene tiempo
ni presupuesto para un sitio web tradicional.

## Problema que resuelve

El negocio no tiene un lugar único, profesional y fácil de compartir donde el cliente final
pueda ver servicios, precios, horarios y contacto antes de escribir. Hoy esa información
vive dispersa entre bio de Instagram, mensajes de WhatsApp y capturas de pantalla
desactualizadas.

## Propuesta de valor

Una página pública, profesional, lista en poco tiempo, con un link y QR que el negocio
puede poner en su bio de Instagram, WhatsApp, tarjetas físicas, vitrina o Google Business
Profile. Sin mantenimiento técnico de su parte.

## MVP incluido

La página pública debe soportar:

- Nombre del negocio (business name).
- Logo o imagen principal.
- Descripción corta.
- Categorías de servicios.
- Servicios individuales con precio opcional.
- Un paquete/promoción destacada (opcional).
- Horarios de atención.
- Dirección.
- Link a Google Maps.
- WhatsApp.
- Instagram (opcional).
- Google Reviews (opcional).
- Políticas básicas (cancelación, puntualidad, pagos, etc.).
- Link público visible.
- QR descargable.
- Una corrección incluida post-entrega.
- Elección entre **6 estilos visuales cerrados** (`black-gold`, `soft-blush`,
  `charcoal-clean`, `warm-sand`, `aqua-clean`, `sage-calm`). Sin colores libres ni
  diseño custom; la personalización es siempre por estilo cerrado. Ver
  [DATA_CONTRACT.md](DATA_CONTRACT.md#estilos-visuales-brand_style).

## Qué NO incluye el MVP

- Dashboard de administración.
- Login / cuentas de usuario.
- Sistema de reservas interno.
- Cobros al cliente final dentro de la página.
- Manejo de inventario.
- Cambios ilimitados post-entrega.
- Diseño custom ilimitado (fuera de las variantes de `brand_style` soportadas).
- Edición manual de fotos/retoque.
- Generación de contenido vía IA por API.
- Marketplace de negocios.
- App móvil.

## Paquetes / precios tentativos

El MVP es de **pago único**. No incluye renovación, hosting recurrente ni cambios futuros;
cualquier cambio posterior a la corrección incluida se cobra aparte, fuera del alcance de
este pago.

| Paquete | Incluye | México (MXN) | US/Canada (USD) |
|---|---|---|---|
| Founder | 1 página, 1 corrección incluida, QR | $599 | $39 |
| Standard | Founder + variante de diseño ampliada | $999 | $69 |
| Extra correction | Corrección adicional individual, fuera de la incluida | $250–$400 | $15–$25 |

Precios son referenciales, pendientes de validar con mercado antes de Phase 7.

**Renovación/mantenimiento anual** (mantener el link/página activos indefinidamente) es una
idea **post-MVP**: no forma parte de la oferta inicial ni de este pago único. Se evaluará
como línea de producto separada una vez validado el MVP.

## Límites operativos

- El MVP se vende como pago único; no incluye renovación ni mantenimiento recurrente.
- Una corrección incluida por pedido; correcciones adicionales tienen costo aparte
  ("Extra correction") y están fuera del alcance cubierto por el pago único inicial.
- El intake se recibe una sola vez por pedido (no hay edición libre del formulario).
- El contenido se limita a los campos definidos en [DATA_CONTRACT.md](DATA_CONTRACT.md).
- Sin soporte para múltiples idiomas en el MVP (una página = un idioma).
- Sin soporte para múltiples sucursales en un mismo pedido.

## Reglas para mantenerlo automatizado

- Todo dato de entrada pasa por el intake estructurado (Tally), nunca por edición manual
  ad-hoc de archivos.
- La generación de la página es determinística a partir del payload de datos: mismo
  payload produce misma página.
- Ninguna corrección se aplica manualmente sin pasar por el link de corrección one-time.
- No se agregan campos libres/custom fuera del contrato de datos sin actualizar
  [DATA_CONTRACT.md](DATA_CONTRACT.md) primero.
- Cualquier paso que requiera intervención manual repetida es una señal de que falta
  automatizar esa etapa, no de que deba resolverse "a mano" cada vez.
