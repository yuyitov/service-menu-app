# Runbook — Service Menu App

Guía operativa manual para el día a día, mientras el pipeline automatizado no esté
completo (Phases 0–3) y como referencia una vez esté en producción.

## Cómo crear una demo

1. Preparar un `service_menu_payload_public` de ejemplo (JSON) siguiendo
   [DATA_CONTRACT.md](DATA_CONTRACT.md), con datos ficticios pero realistas de un salón
   o spa.
2. Generar la página a partir de ese payload usando el generador local (cuando exista,
   Phase 1).
3. Revisar la página contra [QA_CHECKLIST.md](QA_CHECKLIST.md) antes de mostrarla.
4. Nombrar el archivo/slug de demo con prefijo `demo-` para distinguirlo de pedidos
   reales (ej. `demo-salon-luna`).

## Cómo probar un intake dummy

1. Crear un `service_menu_order` de prueba con `order_id` claramente marcado como test
   (ej. prefijo `test-`).
2. Simular el submission de Tally con un payload de `service_menu_intake` de prueba,
   incluyendo ese `order_id`.
3. Verificar que el sistema (o el proceso manual equivalente en Phase 0–1) rechaza
   submissions sin `order_id` válido, como control negativo.
4. Confirmar que el `service_menu_payload_public` derivado no contiene campos internos
   (`payment_intent_id`, `customer_email`, `correction_token`).

## Cómo revisar errores

1. Identificar el `order_id` afectado y su `status` actual.
2. Ubicar el último paso completado exitosamente (usar los estados de
   [DATA_CONTRACT.md](DATA_CONTRACT.md) como checklist).
3. Revisar logs del componente correspondiente a ese paso (Worker, GitHub Actions, email).
4. Si el error es reproducible con el mismo payload, aislarlo con un caso de prueba antes
   de reintentar en el pedido real.
5. Documentar el error y la causa raíz antes de cerrarlo (breve nota, no hace falta
   documento separado salvo que sea recurrente).

## Cómo hacer rollback

1. Identificar la última versión publicada conocida como buena de la página afectada
   (commit anterior en el repo de páginas).
2. Revertir el commit/deploy de GitHub Pages a esa versión.
3. Si el rollback es por un dato incorrecto en el payload, corregir el
   `service_menu_payload_public` antes de volver a publicar, no solo revertir el HTML.
4. Confirmar visualmente que la página revertida es la correcta antes de notificar al
   cliente.

## Cómo manejar una corrección

1. Confirmar que el `correction_token` recibido es válido y no ha sido usado
   (`used_at` vacío).
2. Registrar la solicitud como `service_menu_correction` con `requested_at`.
3. Aplicar únicamente los campos que el cliente indicó cambiar, sobre el intake
   original guardado (no pedir todo el formulario de nuevo salvo que el flujo lo
   requiera).
4. Regenerar y republicar la página.
5. Marcar el token como usado (`used_at`) y el estado del pedido como
   `correction_used`.
6. Confirmar al cliente que la corrección fue aplicada, con el link actualizado.

## Cómo documentar la primera venta

1. Guardar una copia del `service_menu_payload_public` real usado (sin datos de pago).
2. Anotar: fecha, `order_id`, tiempo total desde pago hasta entrega, cualquier paso que
   se hizo manualmente (para detectar qué falta automatizar).
3. Registrar feedback del cliente sobre el intake y la página final.
4. Usar esta primera venta como caso de referencia para ajustar
   [PRODUCT_SPEC.md](PRODUCT_SPEC.md) si algo del alcance resultó distinto en la
   práctica.

## Cómo limpiar pruebas

1. Eliminar/archivar todos los `order_id` con prefijo `test-` o `demo-` de KV (cuando
   exista) y de cualquier registro manual.
2. Eliminar páginas de demo/test publicadas que no deban quedar públicas indefinidamente,
   o marcarlas claramente como demo en su contenido.
3. Verificar que ninguna prueba dejó secrets, tokens o datos de clientes reales
   mezclados con datos dummy.
4. Confirmar que no quedaron branches, workflows en pausa o recursos de Cloudflare
   huérfanos de las pruebas.
