# apps/

Servicios propios. Toda imagen se construye multi-arch (arm64 + amd64) y se firma con cosign (desde F7).

| App | Pieza | Fase | Estado |
|---|---|---|---|
| `worker/quota-monitor` | `cf-r2` (guarda de costo) | F0 | Código y tests; se despliega con OK |
| `api` | `api` | F7 / F18 | Pendiente |
| `ingest` | `ingest` | F13+ | Pendiente |
| `worker/gateway` | `cf-worker` | F11 | Pendiente |

## worker/quota-monitor

Cron horario que lee el uso de R2 (GraphQL Analytics) y publica `r2-guard` en KV con `ok`, `warn`, `stop_uploads` o `stop_all`. Los Workers de subida e ingesta (F13) **deben** leer ese flag y negarse a operar según el nivel.

**Contrato para los consumidores:** si `r2-guard` no existe o su `checkedAt` tiene más de 3 h (`GUARD_MAX_AGE_MS`), se trata como `stop_uploads`. Así, si el monitor o KV se rompen, falla cerrado.

- **Si KV falla:** avisa enseguida.

- **Si la API falla:** nunca relaja el nivel, y después de 48 h sin datos pasa a `stop_uploads` (falla cerrado).
- **Avisos:** al cambiar de nivel, en el primer error y una vez por día mientras el nivel sea mayor que `ok`.
- **Canales:** Telegram (opcional) y, como respaldo, los logs del Worker.

Umbrales en `docs/quotas.md`.
