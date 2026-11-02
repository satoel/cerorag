# Quimera

Plataforma RAG con agentes, multi-cloud, armada solo con free tiers. De uso personal y no comercial.

- Especificación: [`docs/quimera-spec.md`](docs/quimera-spec.md)
- Reglas del proyecto: [`CLAUDE.md`](CLAUDE.md)
- Cupos verificados y presupuestos internos: [`docs/quotas.md`](docs/quotas.md)
- Decisiones: [`docs/decisions/`](docs/decisions/) · Runbooks: [`docs/runbooks/`](docs/runbooks/)

## Estructura

| Carpeta | Contenido |
|---|---|
| `infra/bootstrap/` | Bucket R2 del estado y tokens. Se aplica a mano, ver el runbook. |
| `infra/<proveedor>/` | Un módulo OpenTofu por proveedor (`oci`, `cloudflare`, `google`, `azure`, `aws`, `aiven`). Estado en R2. |
| `deploy/` | Argo CD (app-of-apps), charts y valores por entorno. Desde F5. |
| `apps/` | Servicios propios. Hoy: `worker/quota-monitor`. |
| `scripts/` | Utilidades de CI (guardas de R2, instalación verificada de herramientas). |
| `docs/` | Spec, cupos, runbooks y decisiones (en español). |

## Validación local

```sh
tofu fmt -check -recursive
for m in infra/*/; do (cd "$m" && tofu init -backend=false -input=false && tofu validate); done
tflint --recursive --config "$PWD/.tflint.hcl"
trivy config --skip-dirs '**/.terraform' .
scripts/check-cost-guardrails.sh infra
gitleaks dir --redact .
(cd apps/worker && npm ci && npm run typecheck && npm test)
```

## Reglas clave

- **Cero cargos en la tarjeta:** presupuesto interno del 50 % de cada cupo, monitores y kill switches.
- **Cero secretos en git:** los secretos viven en OpenBao, y en local en archivos `.env*` ignorados.
- **Nada se crea sin OK explícito:** el `apply` corre detrás de un Environment con aprobación manual.

## Licencia

Copyright 2026 Rafael Santos. Distribuido bajo [Apache License 2.0](LICENSE).
