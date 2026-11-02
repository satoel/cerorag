# Runbook: bootstrap del estado de OpenTofu en R2

Crea el bucket `quimera-tfstate`, sus tokens y el token de analytics del `quota-monitor`. Después migra el estado del propio bootstrap a R2.

**Cada paso que crea algo requiere OK explícito en el chat (CLAUDE.md).**

## 0. Requisitos (manuales, una sola vez)

1. **Cuenta de Cloudflare** (una sola, términos §5). Habilitar R2: pide medio de pago. Recomendado: tarjeta virtual o prepaga con límite bajo.
2. **Alertas nativas** (ver `docs/quotas.md`):
   - Budget alert de USD 1: Manage Account → Billing → Billable Usage.
   - Billable Usage notification para R2: Notifications → Add.
3. **Dos passphrases de cifrado:** cada una de al menos 16 caracteres, generadas con `openssl rand -base64 32`.
   - **Admin:** solo para `infra/bootstrap`. Nunca va a GitHub.
   - **Módulos:** para los demás módulos. Va al secret `TF_STATE_PASSPHRASE`.
   - **Por qué dos:** el estado del bootstrap tiene el token rw y vive en el bucket `quimera-tfstate-admin`, al que los tokens de CI no llegan. Aunque un plan de PR filtrara la passphrase de módulos, no podría leer ese estado.
   - Guardarla en tu gestor de contraseñas **y** en una copia offline.
   - **Si se pierde, se pierde el estado.** No hay recuperación.
   - Cuando OpenBao exista (F6), se copia ahí.
4. **Token de bootstrap de Cloudflare:** creado a mano, con vencimiento de 1 día. Permisos:
   - `Account API Tokens Write` + `Account API Tokens Read`, para crear los tokens de abajo.
   - `Workers R2 Storage Write`, para crear el bucket y el lifecycle.

   Se usa solo en este runbook y después se borra.

## 1. Primer apply (estado local, cifrado)

```sh
cd infra/bootstrap
export CLOUDFLARE_API_TOKEN=...            # token de bootstrap (paso 0.4)
export TF_VAR_account_id=...               # 32 hex
export TF_VAR_state_passphrase=...         # passphrase ADMIN (paso 0.3)
tofu init
tofu plan -out=tfplan                      # revisar: 2 buckets, 2 lifecycles, 4 tokens
tofu apply tfplan
```

El `terraform.tfstate` local queda cifrado con AES-GCM. No entra a git porque `.gitignore` lo excluye.

## 2. Migrar el estado del bootstrap a R2

```sh
cp backend_r2.tf.example backend.tf        # bucket quimera-tfstate-admin
export AWS_ENDPOINT_URL_S3="$(tofu output -raw state_endpoint)"
export AWS_ACCESS_KEY_ID="$(tofu output -raw state_admin_access_key_id)"
export AWS_SECRET_ACCESS_KEY="$(tofu output -raw state_admin_secret_access_key)"
tofu init -migrate-state                   # responder "yes"
tofu state pull >/dev/null && echo OK      # se lee desde R2
rm terraform.tfstate terraform.tfstate.backup
git add backend.tf
```

## 3. Verificaciones (criterios de aceptación de F0)

- **Cifrado:** bajar el objeto `bootstrap/terraform.tfstate` desde R2. Tiene que ser un JSON con `"encrypted_data"` y nunca mostrar recursos en claro.
- **Lock:** en dos terminales, `tofu plan` en `infra/cloudflare` (después de `tofu init` con las credenciales rw). El segundo tiene que esperar o fallar con "state locked".
- **Tokens de solo lectura:** con `state_ro_*`, `tofu plan -lock=false` funciona, y `tofu plan` con lock falla porque no puede escribir el lock.
- **Facturación:** el dashboard de facturación de Cloudflare muestra USD 0,00.

## 4. Cargar secretos en GitHub (repo público)

**Repository → Settings:**

- **Variables:** `R2_STATE_ENDPOINT` = salida de `state_endpoint`.
- **Secrets del repo:**
  - `TF_STATE_PASSPHRASE`
  - `R2_STATE_RO_ACCESS_KEY_ID`
  - `R2_STATE_RO_SECRET_ACCESS_KEY`
- **Environment `production`:**
  - Required reviewers: vos.
  - Deployment branches: solo `main`.
  - Secrets: `R2_STATE_RW_ACCESS_KEY_ID`, `R2_STATE_RW_SECRET_ACCESS_KEY`.
- **Actions → General:** "Require approval for all outside collaborators" y "Read repository contents" como permiso por defecto de `GITHUB_TOKEN`.

Después de esto, **borrar el token de bootstrap** en el dashboard.

## 5. Desplegar `quota-monitor` (con OK)

```sh
cd apps/worker/quota-monitor
npx wrangler login
npx wrangler kv namespace create quimera-guard   # pegar el id en wrangler.jsonc
echo -n "$TF_VAR_account_id" | npx wrangler secret put CF_ACCOUNT_ID
(cd ../../../infra/bootstrap && tofu output -raw quota_monitor_token) | npx wrangler secret put CF_ANALYTICS_TOKEN
# Opcional, cuando exista el bot: TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID
npx wrangler deploy
npx wrangler tail   # esperar el cron (minuto 17) o disparar uno desde el dashboard
```

Verificar en KV (`r2-guard`) que `level` sea `ok` y que `budgetUsed` refleje el uso real.

## Rotación

- **Tokens:** `tofu apply -replace=cloudflare_account_token.state_rw` (o `state_ro`, o `quota_monitor`) y después actualizar los secretos de GitHub o Wrangler.
- **Passphrase:**
  1. Agregar en `encryption.tf` un segundo `key_provider` con la passphrase nueva y la vieja como `fallback`.
  2. `tofu apply` en cada módulo.
  3. Quitar el fallback.

  Ver [state encryption](https://opentofu.org/docs/language/state/encryption/).

## Rollback

R2 no tiene versionado de objetos: no hay vuelta atrás de un estado pisado. Antes de cambios grandes, hacer `tofu state pull > backup.tfstate.enc`; queda cifrado.

1. Vaciar los estados de los demás módulos. Solo se puede si no administran recursos.
2. En `infra/bootstrap`: quitar `backend.tf` y migrar a local con `tofu init -migrate-state`.
3. Quitar `prevent_destroy` del bucket y correr `tofu destroy`. Después vaciar el bucket desde el dashboard si queda el lock.
4. Borrar los secretos de GitHub y el Worker (`wrangler delete`).
