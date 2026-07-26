# Pruebas del worker de HMU Link

```bash
node worker/test/run_all.mjs
```

Corren offline: no salen a la red, no mandan correo y no tocan Tally ni KV.

| Archivo | Qué afirma |
|---|---|
| `email-events.test.mjs` | El webhook de eventos de SendGrid: firma ECDSA real, alerta por rebote, dedup. |
| `form-field-coverage.test.mjs` | Cada pregunta de los **formularios vivos** de Tally (EN `yPkN5X` · ES `MeyDpk`) llega a algún campo del payload público, o tiene su razón escrita. Es el candado contra el bug que rompió el intake de PawContact el 2026-07-26: cambia el título de una pregunta, deja de casar con la clave que lee el worker, la respuesta se cae en silencio y los tests siguen verdes. |

## `fixtures/tally_forms_questions.json`

Inventario de las preguntas de los **dos formularios vivos**: ids, tipos, títulos
y el texto de cada opción. Cero respuestas, cero datos de clientes.

> ⚠️ Se mide contra el formulario **VIVO**, por la API de Tally — **nunca** contra
> `tally_form.yaml` del repo. Ese archivo es un **borrador que jamás creó estos
> formularios**, y su propio encabezado lo dice. Compararlo con el código da
> falsos positivos a montones: es exactamente el error que trajo el
> `PLAN_CERO_REGRESIONES_2026-07-26.md`.

### Cuando cambie un formulario de Tally

Hay que volver a tomar el snapshot. Necesita `TALLY_API_KEY` en el entorno:

```bash
node worker/test/tomar_snapshot.mjs
```

Reescribe `fixtures/tally_forms_questions.json` con lo que Tally responda hoy. Si
el cambio rompió el mapeo, `form-field-coverage.test.mjs` lo dice con el título
exacto de la pregunta que dejó de llegar.

El snapshot mezcla dos endpoints, porque ninguno trae todo:

- `GET /forms/<id>/submissions` → `questions[]` — id, tipo y **título tal como lo
  manda el webhook**. Es la autoridad: si una pregunta declara `name`, Tally
  reporta el **nombre** aquí, que es justo el mecanismo del bug del 07-26.
- `GET /forms/<id>` → `blocks[]` — el **texto de cada opción**, que el endpoint de
  submissions devuelve en `null`.

Se emparejan **por orden**, no por título, precisamente porque el título puede
ser el `name`.
