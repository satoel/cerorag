# ADR 0001: estado de OpenTofu en Cloudflare R2, cifrado y con apply aprobado

- **Fecha:** 2026-11-01
- **Estado:** aceptada
- **Piezas:** `tofu`, `cf-r2`, `github`

## Contexto

La spec pone el estado remoto en R2 con backend S3 y `apply` automático al mergear. CLAUDE.md exige OK explícito antes de crear recursos y prohíbe secretos en git, y el repo es público. Además, el dueño exige **cero cargos en la tarjeta** y R2 no tiene tope de costo.

## Decisión

1. **Backend S3 → R2**, con lock nativo (`use_lockfile`, que usa escrituras condicionales soportadas por R2). Una clave por módulo: `<modulo>/terraform.tfstate`. El endpoint viene de `AWS_ENDPOINT_URL_S3`, así que el account id no está en el código.
2. **Cifrado client-side del estado y del plan** (pbkdf2 + aes_gcm, `enforced = true`). El estado contiene secretos (tokens, contraseñas de base).
3. **Bootstrap en `infra/bootstrap`**, con estado local cifrado que después se migra a R2. Lo aplica el dueño en local, nunca CI, porque necesita un token con permiso para crear tokens.
   - Su estado va a un bucket aparte, `quimera-tfstate-admin`, con su propio token y su propia passphrase, ninguno de los cuales está en GitHub.
   - Motivo: ese estado contiene el token rw. Si estuviera en el bucket de módulos, un plan de PR con el token ro más la passphrase podría leerlo y escalar a rw (lo encontró el code-review).
4. **Repo público:** los logs de Actions y los comentarios de PR son públicos. CI nunca imprime el plan ni el apply completos, solo líneas `acción dirección`.
5. **Tokens acotados al bucket:**
   - `rw`: lo usan el apply aprobado y el admin.
   - `ro`: lo usan los plan de PR, con `-lock=false`.
   - Uno de solo analytics para `quota-monitor`.
6. **CI:** en los PR del propio repo (nunca forks) corre plan y lo comenta. Al mergear corre apply detrás del Environment `production`, con aprobación manual.
7. **Guardas de costo:**
   - Solo Standard y sin acceso público, verificado por `scripts/check-cost-guardrails.sh` en CI.
   - Lifecycle que aborta multipart a las 24 h.
   - Monitor horario con kill switch: alerta al 70 % del presupuesto interno (50 % del cupo), corta subidas al 90 %, corta todo al 95 %.

## Consecuencias

- Si se pierde la passphrase, se pierde el estado. Hay que custodiarla en dos lugares y pasarla a OpenBao en F6.
- R2 no versiona objetos: un estado pisado no se recupera. Hay que hacer backups cifrados manuales antes de cambios grandes y, más adelante, copia nocturna a `b2` (F20).
- Los plan de PR con `-lock=false` pueden leer un estado mientras se aplica otro. Es aceptable porque los plan nunca escriben.
- **Desviación del plan:**
  - El plan ponía `infra/cloudflare/r2_guardrails.tf` en F0. Como el bucket de documentos recién llega en F13, las guardas de F0 viven en el bootstrap (bucket de estado) y en el chequeo de CI.
  - El plan mencionaba "lifecycle de versiones viejas", pero R2 no tiene versionado, así que no aplica.
