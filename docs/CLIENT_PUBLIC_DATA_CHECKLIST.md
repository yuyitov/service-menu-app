# Client Public Data Checklist

Guía rápida para decidir qué información de un cliente puede entrar al JSON
público y a la página publicada, y qué debe quedarse fuera. Complementa
[FIRST_CLIENT_RUNBOOK.md](FIRST_CLIENT_RUNBOOK.md) y [SECURITY.md](SECURITY.md).

## ✅ Puede ser público (si el cliente lo dio en las secciones 📢 del intake)

- Nombre del negocio, tipo de negocio y descripción corta.
- Logo y fotos subidas por el cliente (autorizadas en el intake).
- Servicios, categorías, precios/`price_label` y paquete destacado.
- Horarios de atención.
- Dirección pública, notas de ubicación y link de Google Maps.
- WhatsApp público, teléfono público y correo público.
- Instagram, redes, sitio web, link de reservas externo, Google Reviews.
- Políticas para clientes (cancelación, puntualidad, pagos, depósitos).
- Contenido de FAQ que el cliente escribió para su página.

## 🔒 Debe quedarse interno (nunca al repo ni a la página)

- Correo de contacto para la vista previa.
- Nombre de la persona de contacto (salvo que pida publicarlo).
- Teléfono/WhatsApp interno "por si tenemos preguntas".
- La sección completa "qué NO publicar" y cualquier nota privada.
- Detalles del pago (monto acordado, método, comprobantes).
- `order_id`, tokens de corrección y cualquier identificador del pipeline.
- Exports de Tally (CSV/adjuntos crudos).

## 🚫 Nunca se recolecta (ni aunque el cliente lo ofrezca)

- Contraseñas o credenciales de ninguna cuenta.
- Identificaciones oficiales o documentos de identidad.
- Expedientes o información médica.
- Datos de tarjetas o cuentas bancarias.
- Datos personales de los clientes finales del negocio.
- Direcciones particulares que no sean el local público del negocio.

## 🔎 Confirmar con el cliente antes de publicar

- ¿La dirección exacta es pública, o prefiere solo colonia/zona?
- ¿El teléfono/WhatsApp que dio como público es realmente el que quiere mostrar?
- ¿Las fotos incluyen personas identificables? → necesitan consentimiento.
- ¿Los precios que dio pueden mostrarse tal cual? (revisar su elección de
  visibilidad de precios en el intake).
- ¿Algo de la sección "qué no publicar" entra en conflicto con lo que dio? →
  la restricción gana; preguntar si hay duda.
- Nombre comercial vs. razón social: publicar solo el comercial.
