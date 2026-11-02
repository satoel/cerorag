# deploy/

GitOps con Argo CD (patrón app-of-apps), charts y valores por entorno. Se llena desde la fase F5 (ver el plan de fases).

Estructura prevista:

- `bootstrap/argocd/`: instalación inicial de Argo CD en modo core.
- `apps/`: una `Application` por pieza (`traefik`, `cloudflared`, `openbao`, `eso`, `kyverno`, `alloy0`/`alloy1`, …).
- `envs/prod/`: valores del único entorno.
