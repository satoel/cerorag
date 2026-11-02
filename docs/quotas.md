# Cupos verificados

Cada cupo se verifica contra la documentación oficial **antes** de usar la pieza y se anota acá con fecha y link. Si difiere de la spec (`docs/cerorag-spec.md`), se marca y se avisa antes de ajustar nada.

## Regla dura: cero cargos en la tarjeta

Ningún proveedor con tarjeta (Cloudflare, Oracle PAYG, AWS, GCP, Azure) tiene un **tope duro** de gasto. Las alertas avisan pero no cortan. Por eso:

- **Presupuesto interno = 50 % del cupo gratis.** Nunca apuntamos al cupo en sí.
- **Monitores con kill switch** donde se pueda (R2: `apps/worker/quota-monitor`).
- **Si el único camino es pagar, aunque sean centavos, se frena y se pregunta.**
- Recomendado: usar una tarjeta virtual o prepaga con límite bajo para las cuentas con tarjeta.
- **Límite conocido de `scripts/check-cost-guardrails.sh`:** busca literales en el código, así que no ve valores que llegan por variable ni defaults del proveedor (por ejemplo, un `shape = var.x` o un `assign_public_ip` omitido). Alcanza mientras solo existan buckets R2. En F2, con el primer recurso real de OCI, se suma una política sobre `tofu show -json` del plan (conftest/OPA) que valide los valores resueltos.
- **Guarda de R2:** `quota-monitor` corre cada hora. Si no puede leer el uso por más de 3 h (`GUARD_MAX_AGE_MS`), pasa a `stop_uploads`. Si tampoco puede leer el estado anterior en KV, pasa a `stop_all`. Ante un error nunca baja de nivel.

## Fase 0 · verificado el 2026-11-01

### Cloudflare R2 (`cf-r2`)

| Recurso | Cupo gratis (oficial) | Presupuesto interno | Alerta (70 % del presupuesto) | Kill switch subidas (90 %) | Stop total (95 %) |
|---|---|---|---|---|---|
| Almacenamiento Standard | 10 GB-mes | 5 GB | 3,5 GB | 4,5 GB | 4,75 GB |
| Clase A (escrituras, listados) | 1.000.000 / mes | 500.000 | 350.000 | 450.000 | 475.000 |
| Clase B (lecturas) | 10.000.000 / mes | 5.000.000 | 3.500.000 | 4.500.000 | 4.750.000 |
| Egress | Gratis | — | — | — | — |

- El free tier **solo aplica a Standard**, no a Infrequent Access. Además, Infrequent Access cobra por recuperar datos. El CI lo prohíbe con `scripts/check-cost-guardrails.sh`.
- **Sin tope de costo.** Pasado el cupo, se cobra sobre la tarjeta.
- **Operaciones gratis:** DeleteObject, DeleteBucket, AbortMultipartUpload.
- **Medio de pago:** según fuentes secundarias, se pide antes de crear el primer bucket. La documentación oficial no lo dice; se confirma al habilitar R2.
- **Locking:** PutObject soporta `If-None-Match`/`If-Match` atómicos, así que `use_lockfile` de OpenTofu es viable.
- **Medición del monitor:**
  - Ventana móvil de 31 días, que es el máximo de la API y cubre cualquier mes de facturación.
  - Para almacenamiento toma el **pico** por bucket, no el promedio GB-mes.
  - Las operaciones desconocidas se cuentan como clase A.
  - Todo esto es conservador a propósito.
- **Lo que consume el estado de OpenTofu:** unas pocas operaciones por `plan`/`apply`, entre lectura del estado, lock y unlock. Son cientos por mes, despreciable.
- **Fuentes:**
  - [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
  - [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)
  - [R2 tokens](https://developers.cloudflare.com/r2/api/tokens/)
  - [R2 analytics](https://developers.cloudflare.com/r2/platform/metrics-analytics/)

### Alertas nativas de Cloudflare (red de seguridad adicional)

- **Budget alerts:** se configuran en dólares para toda la cuenta y avisan por mail. No cortan el uso. Desde junio de 2026 hay una por defecto. **Configurar en USD 1.**
- **Billable Usage notifications:** se configuran por producto, con umbral en la unidad del producto (bytes o requests). Solo existen para cuentas Pay-as-you-go. **Configurar para R2 con los umbrales de alerta de la tabla.**
- **Fuentes:**
  - [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
  - [Usage based billing](https://developers.cloudflare.com/billing/usage-based-billing)
  - [Changelog 2026-06-15](https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/)

### Cloudflare Workers Free y KV (usados por `quota-monitor`)

| Recurso | Cupo gratis (oficial) | Uso de quota-monitor |
|---|---|---|
| Requests | 100.000 / día; al pasarse **falla** (error 1027), no cobra | 24 invocaciones / día (cron por hora) |
| Cron Triggers | 5 por cuenta | 1 |
| CPU | 10 ms por invocación | Mínimo: el tiempo de espera de red no cuenta |
| Subrequests | 50 por invocación | 1 a 2 (GraphQL y, opcional, Telegram) |
| KV lecturas | 100.000 / día | 24 / día |
| KV escrituras | 1.000 / día | 24 / día |
| KV almacenamiento | 1 GB | < 1 KB |

- **Fuentes:**
  - [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
  - [KV limits](https://developers.cloudflare.com/kv/platform/limits/)
- **Pendiente:** la página de límites de KV no dice si al pasarse falla o cobra. Con 24 operaciones por día estamos 40 veces por debajo, pero hay que verificarlo antes de usar KV en otra pieza.

### GitHub Actions (`github`)

| Recurso | Spec | Oficial | ¿Cambió? |
|---|---|---|---|
| Runners estándar en repo público | Gratis e ilimitados | Gratis e ilimitados | No |
| `ubuntu-24.04-arm` | 4 vCPU, 16 GB | 4 CPU, 16 GB, 14 GB SSD | No |
| Repos privados | 2.000 min / mes | **USD 12 / mes de cómputo** (≈2.000 min Linux 2-core) | Sí, menor. No afecta: el repo es público. |

- **Fuentes:**
  - [Billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
  - [Runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

### OpenTofu (`tofu`)

- Última estable: 1.13.2 (21-oct-2026). En el código se fija con `~> 1.13`.
- **Fuentes:**
  - [Releases](https://github.com/opentofu/opentofu/releases/latest)
  - [S3 backend](https://opentofu.org/docs/language/settings/backends/s3/)
  - [State encryption](https://opentofu.org/docs/language/state/encryption/)

## Gate de Oracle (G1) · verificado el 2026-11-01, se revalida antes de crear la cuenta

| Pieza | Spec | Oficial | ¿Cambió? |
|---|---|---|---|
| A1 | 1.500 OCPU-h, 9.000 GB-h | Igual (2 OCPU / 12 GB) | No |
| Block Volume | 200 GB; boot de 47 GB libera 12 GB | 200 GB total. La página dice "mínimo 47 GB" en un lado y "mínimo 50 GB" en otro. | **Posible.** 47 GB parecen ser los 50 GB expresados en GiB. |
| Autonomous DB | "23ai" | "Autonomous **AI** Database". La versión es **26ai** (reemplaza a 23ai). Las regiones de 26ai Always Free difieren entre páginas oficiales. | **Sí.** Confirmar en la consola que la home region lo ofrece. |
| Vault | "guías de terceros" | Claves por software gratis, 20 versiones de clave HSM, 150 secretos | Confirmado |
| Reclamo por inactividad | — | 7 días con CPU p95, red y memoria por debajo del 20 % (A1) | La spec lo cubre con PAYG |

- **Fuentes:**
  - [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
  - [ADB 26ai Always Free](https://docs.oracle.com/en-us/iaas/autonomous-database-serverless/doc/autonomous-always-free-23ai.html)
  - [Always Free ADB](https://docs.oracle.com/iaas/autonomous-database-shared/doc/autonomous-always-free.html)
