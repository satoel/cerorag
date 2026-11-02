# CeroRAG

Plataforma RAG con agentes, multi-cloud, armada solo con free tiers. Uso personal y no comercial.
La especificación completa está en `docs/cerorag-spec.md`: leela antes de proponer o cambiar arquitectura.
Los ids de las piezas (`cf-worker`, `api`, `litellm`, etc.) son los de la sección 2 de la spec; usalos en planes, commits y docs.

## Reglas

- **Todo lo gratis puede desaparecer.** Originales en Cloudflare R2, fuente de verdad en Oracle Autonomous DB. Todo lo demás (índices, cachés, réplicas) tiene que poder reconstruirse desde ahí con un job documentado.
- **Nada que cree recursos, cuentas o costos sin mi OK explícito en el chat:** `tofu apply`, `kubectl apply` contra el cluster real, `gcloud`/`az`/`aws`/`oci` que creen algo, altas en proveedores. Sí podés correr `tofu fmt`, `tofu validate`, `tofu plan`, linters y tests.
- **Decisiones irreversibles o pagas** (home region de Oracle, pasar a Pay As You Go, cuentas que piden tarjeta): frená y preguntame.
- **Cero secretos en git:** el repo es público. Secretos en OpenBao (y, en local, en archivos `.env*` ignorados). Nunca leas ni muestres `.env*`.
- **Cupos verificados:** antes de usar un free tier, confirmá el límite en la documentación oficial y anotalo en `docs/quotas.md` con fecha y link. Si cambió respecto de la spec, avisame y proponé alternativa; no lo ajustes en silencio.
- **Términos de los proveedores** (sección 5 de la spec): una cuenta por proveedor, nada de carga falsa en Oracle, GitHub Actions solo para CI/CD, Colab solo manual, nada sensible a Gemini free ni Mistral Experiment.
- **Nodos OCI A1 = arm64:** toda imagen se construye multi-arch (arm64 + amd64).
- **Fallos esperados:** cada dependencia externa tiene timeout, reintento con backoff y un fallback definido en la spec (secciones 3 y 6).

## Cómo trabajamos

- Por fases, siguiendo el "Orden de armado" (sección 8 de la spec). Una fase por vez; no adelantes trabajo de la siguiente.
- Al cerrar cada fase: validaciones y tests en verde, `/code-review`, `/security-scan`, docs actualizadas y `/checkpoint`.
- Si algo de la spec es inconsistente, riesgoso o quedó viejo, decímelo antes de implementarlo.
- Código, nombres y commits en inglés (Conventional Commits). Documentación en español.

## Estructura

- `infra/<proveedor>/`: OpenTofu, un módulo por proveedor; estado remoto en R2.
- `deploy/`: Argo CD (app-of-apps), charts y valores por entorno.
- `apps/`: `api`, `ingest`, `worker` (Cloudflare) y demás servicios propios.
- `docs/`: spec, cupos verificados, runbooks y decisiones.
