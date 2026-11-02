# Quimera Multi-Cloud — Especificación de arquitectura

> Exportada del artifact "Quimera Multi-Cloud" (revisión 30-oct-2026). Arquitectura hipotética de **uso personal y no comercial** armada solo con free tiers. Los cupos se verificaron entre julio y octubre de 2026: **revisar cada uno contra la documentación oficial antes de crear la cuenta o el recurso.**

## 1. Objetivo y principios

- Plataforma RAG con agentes para **hasta 50 personas**, con piezas gratuitas de **21 proveedores (63 piezas)**, sin romper los términos de ninguno. Costo objetivo: **USD 0 por mes** (el dominio es aparte). 5 nubes con cómputo; 4 cuentas piden tarjeta.
- **Regla de diseño: todo lo gratis puede desaparecer.** Los originales viven en Cloudflare R2, la fuente de verdad en Oracle Autonomous DB, y cualquier otro índice, caché o réplica se reconstruye desde esos dos.
- Infraestructura como código (OpenTofu), GitOps (Argo CD), cero secretos en git (OpenBao), imágenes firmadas (cosign + Kyverno).

## 2. Componentes por zona

Cada pieza con su id (el que usan los flujos de la sección 3), proveedor, cupo gratis, rol y riesgo.

### Actores

| id | Pieza | Proveedor | Cupo gratis | Rol | Riesgo |
| --- | --- | --- | --- | --- | --- |
| `user` | Usuarios (≤ 50 · navegador) | Clientes | — | Entran por Cloudflare Access con GitHub o Google. El tope de 50 personas lo fija el plan gratis de Zero Trust. |  |
| `admin` | Vos · admin (laptop + teléfono) | Operación | — | Operás por Tailscale (kubectl contra el endpoint privado de OKE) y por Access (Argo CD, Grafana, n8n, APEX). Hacés push al repo. |  |

### Borde · Cloudflare (plan free)

| id | Pieza | Proveedor | Cupo gratis | Rol | Riesgo |
| --- | --- | --- | --- | --- | --- |
| `cf-access` | Access (≤ 50 usuarios) | Cloudflare Zero Trust | Plan Zero Trust gratis hasta 50 usuarios, con 24 h de logs de actividad. | Login OIDC (GitHub o Google) para usuarios y admins. Emite el JWT que valida el Worker. Protege Argo CD, Grafana, n8n y APEX. | Pasar de 50 usuarios cuesta USD 7 por usuario y por mes. |
| `cf-pages` | Pages (SPA estática) | Cloudflare | Sitios estáticos ilimitados. | Frontend del chat y del panel de documentos. |  |
| `cf-worker` | Worker gateway (100k req/día) | Cloudflare Workers | 100.000 requests por día; 50 subrequests por invocación en el plan free. | El corazón del borde: valida el JWT de Access, aplica rate-limit, consulta la caché y elige el origen sano (OKE → Cloud Run → Container Apps → Vectorize). | Cada pregunta usa unas 4 subrequests. Ningún fan-out debe acercarse a 50. |
| `cf-do` | Durable Objects (SQLite · 5 GB) | Cloudflare | 100.000 requests/día, 13.000 GB-s/día y 5 GB de SQL en el plan free. | Un objeto por usuario para la ventana de rate-limit y la sesión de streaming; uno global con el estado de salud de cada origen. |  |
| `cf-ai` | Workers AI (10k neuronas/día) | Cloudflare | 10.000 neuronas por día, compartidas entre todos los modelos; se resetea a las 00:00 UTC. En el plan free, al agotarse falla en vez de cobrar. | Embeddings BGE para preguntas e ingesta. | Si se agota, el embedder cae al modelo local de a1-1. |
| `cf-vec` | Vectorize (5M dims guardadas) | Cloudflare | 5 millones de dimensiones guardadas y 30 millones consultadas por mes. | Caché de borde con ~6.500 vectores de 768 dimensiones (preguntas frecuentes). Último recurso si se cae todo el core. |  |
| `cf-dns` | DNS · WAF · CDN (DDoS sin medidor) | Cloudflare | Plan free de zona, con mitigación DDoS sin medidor. | Zona del dominio, certificados de borde y reglas WAF. | El dominio es lo único que se paga. |
| `cf-r2` | R2 (10 GB · egress $0) | Cloudflare | 10 GB, 1M operaciones clase A y 10M clase B por mes; egress siempre gratis. | Originales de los documentos (subida firmada desde el navegador), estado de OpenTofu y volcados del grafo. |  |
| `cf-queue` | Queues (retención 24 h) | Cloudflare | Incluido en Workers Free desde febrero de 2026; retención máxima de 24 h (14 días en pago). | Amortiguador del borde: si el core está caído, los avisos de subida esperan hasta 24 h. | Más de 24 h de caída pierde avisos; los archivos siguen en R2 y un job de reconciliación los recupera. |
| `cf-tunnel` | Tunnel (2 conectores salientes) | Cloudflare Zero Trust | Incluido en el plan Zero Trust gratis. | Única entrada al core. cloudflared abre conexiones salientes desde a1-0 y Micro A: cero puertos abiertos en OCI y sin load balancer público. |  |

### Oracle OCI · us-ashburn-1 · Always Free + Pay As You Go

Dos nodos A1 de OKE: **a1-0** (plataforma, 1 OCPU · 6 GB, ≈3,5 GB en uso) y **a1-1** (app + IA, 1 OCPU · 6 GB, ≈5 GB en uso).

| id | Pieza | Proveedor | Cupo gratis | Rol | Riesgo |
| --- | --- | --- | --- | --- | --- |
| `oke-cp` | OKE Basic (control plane $0) | Oracle Cloud | Los clusters Basic no cobran control plane y los nodos A1 entran en Always Free. Pide tarjeta. | Kubernetes gestionado: el control plane no consume tus 12 GB de RAM. | No figura formalmente en Always Free; Oracle podría empezar a cobrarlo. Plan B: k3s sobre las mismas dos VMs. |
| `micro-a` | Micro A · conector (1/8 OCPU · 1 GB) | Oracle Cloud | 2 VMs AMD VM.Standard.E2.1.Micro de 1/8 OCPU y 1 GB cada una. | Segundo conector cloudflared (el Tunnel sobrevive a la caída de a1-0) y subnet router de Tailscale hacia la VCN privada. |  |
| `micro-b` | Micro B · backups (1/8 OCPU · 1 GB) | Oracle Cloud | La segunda VM E2.1.Micro. | Vive fuera del cluster a propósito: corre los backups restic y el export Data Pump aunque Kubernetes esté roto. |  |
| `oci-vault` | OCI Vault (KMS · auto-unseal) | Oracle Cloud | Vault entra en Always Free; guías de terceros citan 20 claves HSM y 150 secretos. | Clave de auto-unseal de OpenBao. |  |
| `cloudflared` | cloudflared — nodo a1-0 | Cloudflare · open source | Open source, corre dentro de OKE sin costo. | Conector 1 del Tunnel. Sale hacia Cloudflare; nada entra. |  |
| `argocd` | Argo CD — nodo a1-0 | CNCF | Open source, corre dentro de OKE sin costo. | GitOps con patrón app-of-apps desde el repo público. GitHub nunca tiene credenciales del cluster. |  |
| `traefik` | Traefik — nodo a1-0 | Traefik Labs · open source | Open source, corre dentro de OKE sin costo. | Ingress del cluster: recibe lo que trae el Tunnel y enruta a la API, los paneles y APEX. |  |
| `openbao` | OpenBao — nodo a1-0 | Linux Foundation | Open source, corre dentro de OKE sin costo. | Fork open source de Vault. Guarda las claves de los proveedores de IA y emite credenciales dinámicas de base. |  |
| `eso` | Ext. Secrets — nodo a1-0 | CNCF | Open source, corre dentro de OKE sin costo. | External Secrets Operator: copia secretos de OpenBao a Kubernetes y los refresca. |  |
| `kyverno` | Kyverno — nodo a1-0 | CNCF | Open source, corre dentro de OKE sin costo. | Política de admisión: solo entran imágenes firmadas con cosign por el workflow del repo. |  |
| `alloy0` | Alloy — nodo a1-0 | Grafana · open source | Open source, corre dentro de OKE sin costo. | Agente OpenTelemetry del nodo de plataforma: métricas, logs y trazas hacia Grafana Cloud. |  |
| `cron` | CronJobs — nodo a1-0 | Kubernetes | Open source, corre dentro de OKE sin costo. | Trabajos nocturnos: Kafka → Parquet → GCS, volcado del grafo y reindexado de Qdrant. |  |
| `n8n` | n8n — nodo a1-0 | n8n · fair-code | Self-hosted dentro de OKE. | Automatizaciones: ingesta por mail y avisos a Telegram. Su base está en Aiven PostgreSQL. | Licencia fair-code: sin problema para uso propio; revisala si Quimera se vuelve producto. |
| `api` | API — nodo a1-1 | FastAPI | Open source, corre dentro de OKE sin costo. | Orquesta la recuperación híbrida (Qdrant + BM25 + grafo), arma el prompt, llama a LiteLLM y guarda el historial. |  |
| `litellm` | LiteLLM — nodo a1-1 | BerriAI · open source | Open source, corre dentro de OKE sin costo. | Gateway compatible con la API de OpenAI. Política: sensible → Ollama; el resto → Groq → Gemini → OpenRouter; lotes → Mistral. Respeta RPM, RPD y tokens de cada proveedor. |  |
| `ollama` | Ollama — nodo a1-1 | Ollama · open source | Open source, corre dentro de OKE sin costo. | Modelo local de 3–4B en Q4 (~3 GB de RAM) y modelo de embeddings. Lento con 1 OCPU, pero privado y siempre disponible. |  |
| `ingest` | Ingest — nodo a1-1 | Python | Open source, corre dentro de OKE sin costo. | Consumidores de Kafka: parseo, chunking, embeddings, upserts y extracción de entidades. |  |
| `rerank` | Reranker — nodo a1-1 | Cross-encoder en CPU | Open source, corre dentro de OKE sin costo. | Reordena los ~40 candidatos y deja 8 pasajes. |  |
| `alloy1` | Alloy — nodo a1-1 | Grafana · open source | Open source, corre dentro de OKE sin costo. | Agente OpenTelemetry del nodo de app + IA. |  |

### Réplicas y serverless

| id | Pieza | Proveedor | Cupo gratis | Rol | Riesgo |
| --- | --- | --- | --- | --- | --- |
| `cloud-run` | Cloud Run · GCP (2M req/mes) | Google Cloud | 2M requests, 180.000 vCPU-s y 360.000 GiB-s por mes. | Réplica amd64 de la API en modo degradado (sin Ollama ni grafo). Escala a cero mientras no hay failover. | Egress gratis de 1 GB/mes: alcanza para failover con respuestas chicas, no para servir todo. |
| `aca` | Container Apps (180k vCPU-s/mes) | Microsoft Azure | 180.000 vCPU-s, 360.000 GiB-s y 2M requests por mes, siempre gratis. | Segunda réplica, en otra empresa. Tira la imagen desde ACR. |  |
| `lambda` | Lambda · AWS (400k GB-s/mes) | Amazon Web Services | 1M requests y 400.000 GB-s por mes, siempre gratis también en cuentas nuevas. | Parser de PDF y DOCX invocado por Function URL: saca la CPU pesada de los nodos A1. |  |
| `acr` | ACR · Azure (1 registro · 100 GB) | Microsoft Azure | 1 registro Standard con 100 GB y 10 webhooks, siempre gratis. | Espejo amd64 de las imágenes para Container Apps. |  |

### Observatorio y acceso

| id | Pieza | Proveedor | Cupo gratis | Rol | Riesgo |
| --- | --- | --- | --- | --- | --- |
| `gcp-vm` | e2-micro · GCP (us-east1 · sondas) | Google Cloud | 1 e2-micro en us-west1, us-central1 o us-east1, con 30 GB de disco estándar. | Sondas externas (Gatus y blackbox exporter) contra los endpoints públicos: ve lo mismo que un usuario, desde otra nube. | Solo 1 GB/mes de egress gratis (~33 MB por día): sondas cada 5 minutos y pocas series. |
| `tailscale` | Tailscale (Personal · 6 usuarios) | Tailscale | Plan Personal gratis: 6 usuarios, dispositivos de usuario ilimitados y 50 recursos con tag. | Malla WireGuard entre tus equipos, Micro A y la VM de GCP. | Solo uso no comercial. Si Quimera factura: Headscale en Micro A. |

### Datos · todo se reconstruye desde R2 + Autonomous DB

| id | Pieza | Proveedor | Cupo gratis | Rol | Riesgo |
| --- | --- | --- | --- | --- | --- |
| `adb1` | Autonomous DB #1 (23ai · 20 GB · verdad) | Oracle Cloud | 2 Autonomous DB Always Free de 1 OCPU y 20 GB cada una. 23ai trae tipo VECTOR y AI Vector Search. | Fuente de verdad: documentos, chunks y vectores. Cualquier índice externo se reconstruye desde acá. | Solo se crea en la home region. Al elegirla, verificá que ofrezca 23ai en Always Free. |
| `adb2` | Autonomous DB #2 (APEX · back-office) | Oracle Cloud | Segunda instancia Always Free. | Consola de administración en APEX: usuarios, cupos, documentos y configuración. |  |
| `qdrant` | Qdrant Cloud (1 GB RAM · 4 GB disco) | Qdrant | 1 nodo con 0,5 vCPU, 1 GB de RAM y 4 GB de disco, sin tarjeta. Se suspende tras 1 semana sin uso y se borra a las 4 semanas. | Índice caliente denso + sparse, con cuantización int8. | Si se suspende, el CronJob de reindexado lo reconstruye desde ADB. |
| `opensearch` | OpenSearch · Aiven (BM25 · 20 GB) | Aiven | 20 GB, 4 GB de RAM y hasta 20 shards. Una instancia free por tipo de servicio. | Búsqueda léxica BM25, fusionada con Qdrant por Reciprocal Rank Fusion. |  |
| `kafka` | Kafka · Aiven (5 topics · 3 días) | Aiven | 5 topics de 2 particiones, throughput fijo (~250 kb/s) y retención fija; sin Kafka Connect. | Backbone de eventos con 4 de los 5 topics: doc.uploaded, doc.parsed, chunk.embedded y answer.logged. | Aiven puede cambiar la nube o región de un servicio free: el endpoint vive en OpenBao, no en el código. |
| `neo4j` | Neo4j Aura Free (200k nodos) | Neo4j | 200.000 nodos, 400.000 relaciones y 1 GB; un backup a demanda por vez. | GraphRAG: entidades y relaciones extraídas de los documentos para ampliar el contexto. |  |
| `cosmos` | Cosmos DB · Azure (1000 RU/s · 25 GB) | Microsoft Azure | 1.000 RU/s y 25 GB de por vida; una cuenta free por suscripción, que se activa al crearla. | Historial de conversaciones como documentos JSON por sesión. |  |
| `upstash` | Upstash Redis (256 MB · 500k cmd) | Upstash | 256 MB, 500.000 comandos por mes y 10 GB de transferencia; una base. | Caché de respuestas por hash de pregunta. Habla REST, así que el Worker lo usa directo. |  |
| `aiven-pg` | PostgreSQL · Aiven (1 GB · n8n + LiteLLM) | Aiven | 1 GB de disco y 1 GB de RAM. | Base de n8n y registro de gasto y cupos de LiteLLM. |  |
| `oci-os` | OCI Object Storage (20 GB · backup #1) | Oracle Cloud | 20 GiB Always Free entre Object y Archive Storage. | Backups restic cifrados y exports Data Pump de ADB. |  |
| `b2` | Backblaze B2 (10 GB · backup #2) | Backblaze | 10 GB gratis; egress gratis hasta 3 veces lo guardado y gratis hacia Cloudflare. | Segunda copia, fuera de Oracle y en otra empresa (regla 3-2-1). |  |
| `dynamo` | DynamoDB · AWS (25 GB · auditoría) | Amazon Web Services | 25 GB con 25 RCU y 25 WCU, siempre gratis. | Bitácora inmutable: quién subió qué y qué procesó el parser. |  |
| `gcs` | Cloud Storage · GCP (5 GB · staging) | Google Cloud | 5 GB-mes Standard, solo en regiones de EE.UU. | Staging de los Parquet diarios que carga BigQuery. |  |
| `bigquery` | BigQuery (1 TB consultas/mes) | Google Cloud | 1 TB de consultas por mes. | Analítica de uso, latencia y costo evitado por proveedor. Grafana lo lee como datasource. |  |

### Modelos · LiteLLM enruta por sensibilidad y cupo

| id | Pieza | Proveedor | Cupo gratis | Rol | Riesgo |
| --- | --- | --- | --- | --- | --- |
| `groq` | Groq (200k tokens/día) | Groq | gpt-oss-120b: 30 RPM, 1.000 requests/día, 8.000 TPM y 200.000 tokens/día. Límites por modelo y por organización. | Ruta por defecto para datos no sensibles: la más rápida. | Se acaban antes los tokens que las requests: ~100 respuestas de 2.000 tokens por día. |
| `gemini` | Gemini Flash (free · contexto largo) | Google AI | Flash y Flash-Lite con cupo gratis por proyecto (visible en AI Studio). En free, Google puede usar prompts y respuestas para mejorar sus productos. | Fallback 1 y resúmenes de documentos largos. Solo datos no sensibles. | Prohibido usarlo para entrenar modelos que compitan con Gemini. Para usuarios en UE, Reino Unido o Suiza, solo plan pago. |
| `openrouter` | OpenRouter :free (50 req/día) | OpenRouter | Modelos :free con 20 RPM y 50 requests/día (1.000 si alguna vez compraste USD 10 de créditos). | Fallback 2: variedad de modelos con cupo chico. |  |
| `mistral` | Mistral Experiment (1B tokens/mes · lotes) | Mistral AI | Alrededor de 1.000 millones de tokens por mes con muy pocas requests por minuto. Exige aceptar el uso de tus datos para entrenamiento. | Trabajos nocturnos: extracción de entidades y etiquetado de documentos públicos. |  |
| `zerogpu` | HF ZeroGPU Space (GPU por request) | Hugging Face | Una cuenta free puede alojar hasta 2 Spaces Gradio en ZeroGPU; los demás Spaces con cómputo piden plan pago. | OCR de PDFs escaneados y reranking pesado ocasional. | Cuota diaria de GPU de pocos minutos para quien llama. |
| `colab` | Colab · T4 (LoRA a mano) | Google Colab | GPU gratis sin garantía. En free no se permiten SSH, UIs web ni workers distribuidos; nunca hosting de archivos ni servicios web. | Fine-tuning LoRA interactivo con datos propios o abiertos. |  |
| `hfhub` | Hugging Face Hub (adapters + GGUF) | Hugging Face | Repositorios de modelos. | Guarda el adapter LoRA y el GGUF que descarga Ollama. |  |

### Plataforma · CI/CD, observabilidad y alertas

| id | Pieza | Proveedor | Cupo gratis | Rol | Riesgo |
| --- | --- | --- | --- | --- | --- |
| `sentry` | Sentry (5k errores/mes) | Sentry | Plan Developer: 5.000 errores por mes, 1 usuario. | Errores de la SPA y de la API. |  |
| `langfuse` | Langfuse (50k units/mes) | Langfuse | Hobby: 50.000 units por mes, 30 días de datos, 2 usuarios. | Trazas de LLM, costo evitado y evaluación de prompts. | Unas 6 units por consulta trazada: muestreá el 25%. |
| `grafana` | Grafana Cloud (10k series · 14 días) | Grafana Labs | 10.000 series activas, 50 GB de logs, 50 GB de trazas y 50 GB de profiles por mes; 14 días de retención; 3 usuarios. | Métricas, logs, trazas y alertas de todo el stack, más paneles sobre BigQuery. | kube-state-metrics sin filtrar consume muchas series: relabel en Alloy. |
| `resend` | Resend + Telegram (100 mails/día) | Resend · Telegram | Resend: 3.000 mails por mes con tope de 100 por día. | Alertas por mail; las urgentes, por un bot de Telegram. |  |
| `tofu` | OpenTofu (estado en R2) | Linux Foundation | Open source, corre dentro de OKE sin costo. | IaC de todos los proveedores (oci, google, azurerm, aws, cloudflare, aiven y más). Corre en Actions; estado remoto en R2. |  |
| `ghcr` | GHCR (imágenes firmadas) | GitHub | Registro de paquetes de GitHub. | Imágenes multi-arch (arm64 + amd64) firmadas con cosign. |  |
| `github` | GitHub Actions (repo público · arm64) | GitHub | Runners estándar gratis e ilimitados en repos públicos, incluido ubuntu-24.04-arm (4 vCPU, 16 GB). En privados: 2.000 minutos por mes. | CI: tests, build multi-arch nativo, firma keyless y tofu plan/apply. | Términos: Actions no es cómputo serverless, ni CDN, ni para minar. Solo CI/CD. |

## 3. Flujos

Cada paso: `origen → destino` · etiqueta · detalle. *(async)* = asíncrono o por lotes.

### Consulta

Una pregunta de punta a punta: login, caché, recuperación híbrida y ruteo de modelos por sensibilidad.

1. `user` → `cf-access` · **Login OIDC** · Entrás con GitHub o Google; Access emite un JWT firmado en la cookie CF_Authorization.
2. `cf-access` → `cf-pages` · **SPA** · Pages sirve el frontend estático desde el borde.
3. `cf-pages` → `cf-worker` · **POST /api/ask** · La SPA llama al gateway con el JWT de Access.
4. `cf-worker` → `cf-do` · **Rate-limit** · El Durable Object del usuario lleva la ventana deslizante de preguntas por hora.
5. `cf-worker` → `upstash` · **GET caché** · Busca por hash de la pregunta normalizada. Si hay hit, responde ahí y no toca el core.
6. `cf-worker` → `cf-tunnel` · **Origen primario** · Sin hit, el Worker manda la request al origen sano: normalmente OKE por el Tunnel.
7. `cf-tunnel` → `traefik` · **Tunnel → Traefik** · cloudflared ya tiene conexiones salientes abiertas; la request entra sin puertos públicos.
8. `traefik` → `api` · **HTTP interno** · Traefik enruta a la API en a1-1.
9. `api` → `cf-ai` · **Embedding** · Embedding BGE de la pregunta. Si se agotó el cupo diario, usa el embedder local.
10. `api` → `qdrant` · **Top-40 híbrido** · Búsqueda densa + sparse por gRPC.
11. `api` → `opensearch` · **Top-40 BM25** · Búsqueda léxica; la API fusiona ambas listas con RRF.
12. `api` → `neo4j` · **Expansión de grafo** · Toma las entidades de los 10 mejores pasajes y suma sus vecinos a un salto.
13. `api` → `rerank` · **Rerank** · El cross-encoder deja 8 pasajes.
14. `api` → `litellm` · **Prompt + contexto** · Viaja con la etiqueta de sensibilidad de cada documento.
15. `litellm` → `groq` · **Ruta por defecto** · Datos no sensibles van a Groq.
16. `litellm` → `gemini` · **Fallback 1** · Si Groq devuelve 429 o se agotaron los tokens del día.
17. `litellm` → `openrouter` · **Fallback 2** · Modelos :free, con cupo chico.
18. `litellm` → `ollama` · **Sensible o último recurso** · Si hay un pasaje sensible, la consulta nunca sale del cluster.
19. `api` → `cosmos` · **Historial** · Guarda el turno y las citas en la sesión.
20. `api` → `kafka` · **answer.logged** · Evento para auditoría y analítica. *(async)*
21. `api` → `upstash` · **SET caché** · TTL de 24 h, solo para respuestas sin pasajes sensibles.

### Ingesta

Un PDF desde el navegador hasta la fuente de verdad y los cuatro índices.

1. `cf-pages` → `cf-worker` · **URL firmada** · La SPA pide una URL de subida firmada para R2.
2. `user` → `cf-r2` · **PUT directo** · El navegador sube a R2: el archivo nunca pasa por el core.
3. `cf-r2` → `cf-queue` · **Objeto creado** · Notificación de evento del bucket. *(async)*
4. `cf-queue` → `cf-tunnel` · **Consumer** · Un Worker consumidor llama a /ingest por el Tunnel; si el core no responde, reintenta hasta 24 h. *(async)*
5. `cf-tunnel` → `ingest` · **/ingest** · Entra por Traefik hasta los workers de ingesta.
6. `ingest` → `kafka` · **doc.uploaded** · Evento inicial del pipeline. *(async)*
7. `ingest` → `lambda` · **Parseo** · Lambda baja el archivo de R2, extrae texto y tablas y devuelve JSON.
8. `lambda` → `dynamo` · **Auditoría** · Registro inmutable del documento procesado. *(async)*
9. `ingest` → `zerogpu` · **OCR** · Solo PDFs escaneados y solo si queda cuota de GPU; si no, quedan en espera.
10. `ingest` → `cf-ai` · **Embeddings** · Lotes de chunks de ~500 tokens.
11. `ingest` → `adb1` · **Chunks + VECTOR** · Primero se escribe la fuente de verdad.
12. `ingest` → `qdrant` · **Upsert** · Índice caliente denso + sparse.
13. `ingest` → `opensearch` · **Indexa** · Índice léxico BM25.
14. `ingest` → `mistral` · **Entidades** · Extracción de entidades y relaciones por la noche, con el cupo de Mistral. *(async)*
15. `ingest` → `neo4j` · **MERGE** · Nodos y relaciones idempotentes.
16. `ingest` → `cf-vec` · **FAQ al borde** · Solo los chunks más consultados, unos 6.500 vectores. *(async)*

### Failover

Qué pasa cuando se cae Oracle, después Google, y después todo.

1. `cf-worker` → `cf-tunnel` · **Health check** · Timeout corto; tres fallos seguidos marcan el origen como caído.
2. `cf-worker` → `cf-do` · **Estado de origen** · El objeto global recuerda qué origen está sano para no volver a probar en cada request.
3. `cf-worker` → `cloud-run` · **Réplica GCP** · API sin Ollama ni grafo: Qdrant y un LLM en la nube.
4. `cloud-run` → `qdrant` · **Solo denso** · Recuperación mínima.
5. `cloud-run` → `gemini` · **LLM directo** · SDK directo, misma política: nada sensible.
6. `cf-worker` → `aca` · **Réplica Azure** · Si Cloud Run también falla.
7. `aca` → `groq` · **LLM directo** · Mismo modo degradado, otro proveedor.
8. `cf-worker` → `upstash` · **Caché vencida** · Sirve respuestas cacheadas aunque hayan expirado.
9. `cf-worker` → `cf-vec` · **Último recurso** · Si cae todo, responde con la pregunta frecuente más cercana.

### CI/CD

Del push al cluster con imágenes firmadas y sin credenciales del cluster en GitHub.

1. `admin` → `github` · **git push** · Monorepo público: app, charts y OpenTofu.
2. `github` → `ghcr` · **Build + cosign** · buildx en runners nativos arm64 y amd64; firma keyless con el OIDC de Actions.
3. `github` → `acr` · **Espejo amd64** · Copia para que Container Apps tire desde Azure.
4. `github` → `tofu` · **plan / apply** · En el PR, plan comentado; al mergear, apply.
5. `tofu` → `cf-r2` · **Estado** · Backend S3 apuntando a R2.
6. `tofu` → `oke-cp` · **Infra OCI** · VCN, OKE, Autonomous DB, Vault y buckets.
7. `argocd` → `github` · **Pull** · Argo CD observa el repo; GitHub no guarda credenciales del cluster.
8. `argocd` → `api` · **Sync** · Despliega; Kyverno rechaza imágenes sin firma válida.
9. `github` → `cloud-run` · **Deploy réplica** · Con Workload Identity Federation, sin claves guardadas.
10. `github` → `aca` · **Deploy réplica** · Con federación OIDC de Entra ID.
11. `colab` → `hfhub` · **LoRA → GGUF** · Fine-tuning a mano en el notebook; se publica el GGUF. *(async)*
12. `ollama` → `hfhub` · **Pull modelo** · Ollama descarga la versión nueva. *(async)*

### Observabilidad

Telemetría, errores, trazas de LLM y sondas desde otra nube.

1. `alloy0` → `grafana` · **OTLP** · Métricas, logs y trazas del nodo de plataforma.
2. `alloy1` → `grafana` · **OTLP** · Ídem para app + IA, con relabel para no pasar las 10.000 series.
3. `api` → `sentry` · **Excepciones** · Errores de la API; la SPA reporta directo desde el navegador.
4. `litellm` → `langfuse` · **Trazas LLM** · Muestreo del 25% para no pasar 50.000 units. *(async)*
5. `litellm` → `aiven-pg` · **Gasto y cupos** · Tokens, 429 y latencia por proveedor: alimenta el ruteo.
6. `gcp-vm` → `cf-dns` · **Sondas HTTP** · Cada 5 minutos contra la app, la API y el Tunnel, desde otra nube.
7. `gcp-vm` → `grafana` · **Resultados** · Remote write con pocas series para cuidar el GB de egress.
8. `grafana` → `resend` · **Alertas** · Mail para avisos; Telegram para urgencias.
9. `grafana` → `bigquery` · **Datasource** · Paneles de uso, latencia y costo evitado.

### Backup y analítica

Copias en dos empresas distintas y un data warehouse alimentado de noche.

1. `cron` → `kafka` · **Consume el día** · Lee answer.logged de las últimas 24 h. *(async)*
2. `cron` → `gcs` · **Parquet** · Un archivo particionado por día. *(async)*
3. `gcs` → `bigquery` · **Load job** · La carga es gratis; las consultas usan el TB mensual. *(async)*
4. `micro-b` → `adb1` · **Data Pump** · Export semanal del esquema. *(async)*
5. `micro-b` → `oci-os` · **restic 1** · Copia cifrada dentro de Oracle. *(async)*
6. `micro-b` → `b2` · **restic 2** · Copia cifrada en otra empresa. *(async)*
7. `cron` → `neo4j` · **Export del grafo** · Volcado Cypher semanal. *(async)*
8. `cron` → `cf-r2` · **Snapshot** · Guarda el volcado del grafo y los manifiestos. *(async)*
9. `cron` → `adb1` · **Lee vectores** · Fuente del reindexado. *(async)*
10. `cron` → `qdrant` · **Reindex** · Si Qdrant fue suspendido o borrado, lo reconstruye. *(async)*

### Seguridad

Sin puertos abiertos, sin secretos en git y sin endpoints de administración públicos.

1. `admin` → `tailscale` · **WireGuard** · Tu laptop y tu teléfono en la tailnet.
2. `tailscale` → `micro-a` · **Subnet router** · Micro A anuncia la subred privada de la VCN.
3. `micro-a` → `oke-cp` · **kubectl privado** · El endpoint de la API de OKE no tiene IP pública.
4. `admin` → `cf-access` · **Paneles** · Argo CD, Grafana, n8n y APEX detrás de Access.
5. `traefik` → `adb2` · **Proxy APEX** · APEX se publica por el Tunnel; la ACL de ADB solo acepta la IP del NAT de la VCN.
6. `cloudflared` → `cf-tunnel` · **Saliente 1** · Conexión saliente desde a1-0.
7. `micro-a` → `cf-tunnel` · **Saliente 2** · Segundo conector: el Tunnel sobrevive a la caída de a1-0.
8. `openbao` → `oci-vault` · **Auto-unseal** · OpenBao arranca solo con la clave del Vault de OCI.
9. `eso` → `openbao` · **Lee secretos** · Sincroniza a Secrets de Kubernetes, con refresh.
10. `openbao` → `adb1` · **Credenciales dinámicas** · Usuarios de base con TTL corto para la API.
11. `kyverno` → `ghcr` · **Verifica firma** · Admite solo imágenes firmadas por el workflow del repo.

## 4. Presupuesto de cupos

Cada límite gratis traducido a lo que significa para Quimera. Las filas marcadas como estimación son cálculos propios, no cifras del proveedor.

| Recurso | Cupo gratis | Qué significa acá |
| --- | --- | --- |
| Cloudflare Workers | 100.000 req/día | ≈1,16 req/s sostenidas. Cada pregunta usa ~4 subrequests; el tope free es 50 por invocación. |
| Groq gpt-oss-120b | 200k tokens/día | ~100 respuestas de 2.000 tokens. Los tokens se agotan mucho antes que las 1.000 requests diarias. |
| Upstash Redis | 500k comandos/mes | ~16.600 por día: ~5.500 preguntas con 3 comandos cada una (GET, INCR, SET). |
| Vectorize | 5M dims · 30M consultadas | ~6.500 vectores de 768 dimensiones y ~39.000 consultas por mes. Solo sirve como caché de preguntas frecuentes. |
| Qdrant Cloud | 1 GB RAM · 4 GB disco | Cientos de miles de vectores de 768 dims con cuantización int8 en RAM y originales en disco. Estimación. |
| Autonomous DB 23ai | 20 GB c/u | ~3 a 4 millones de chunks a ~5 KB (texto más un VECTOR float32 de 768 dims, 3 KB). Estimación; el límite real será 1 OCPU. |
| Oracle A1 | 1.500 OCPU-h · 9.000 GB-h | 2 OCPU y 12 GB las 24 horas: dos nodos de 1 OCPU / 6 GB. |
| Oracle Block Volume | 200 GB | 4 VMs × 50 GB de boot = 200 GB. No queda margen; bajando cada boot a 47 GB liberás 12. |
| Cloud Run | 180k vCPU-s/mes | 50 horas de vCPU por mes. Alcanza para failover, no para servir todo el tráfico. |
| Lambda | 400k GB-s/mes | ~111 horas al mes con 1 GB de memoria para parsear documentos. |
| GCP e2-micro | 1 GB egress/mes | ~33 MB por día: sondas cada 5 minutos y pocas series, nunca tráfico entre nodos. |
| Langfuse Hobby | 50k units/mes | ~6 units por consulta trazada: ~8.300 trazas al mes. Muestreo del 25%. |
| Grafana Cloud | 10.000 series | Dos nodos más kube-state-metrics sin filtrar se comen buena parte. Relabel en Alloy. |
| Workers AI | 10k neuronas/día | Compartido entre embeddings y modelos. Al agotarse falla, no cobra: fallback al embedder local. |
| Resend | 100 mails/día | Solo alertas. Lo urgente va por Telegram. |

## 5. Reglas para no romper términos

Lo que separa “gratis y prolijo” de “cuenta suspendida”.

1. **Una cuenta por persona y proveedor.** Oracle lo exige; Colab prohíbe usar varias cuentas para esquivar límites; en Gemini y OpenRouter las claves extra no suman cupo.
2. **Nada de carga falsa en Oracle.** El reclamo por inactividad se evita pasando la cuenta a Pay As You Go: sigue gratis dentro de Always Free. Alerta de presupuesto en USD 1.
3. **GitHub Actions es CI/CD.** Ni cron de la aplicación, ni backend serverless, ni CDN, ni minería.
4. **Colab es un notebook interactivo.** El fine-tuning lo corrés vos, a mano. En free, nada de SSH, UIs web ni servir modelos.
5. **Gemini free y Mistral Experiment usan tus datos.** Solo documentos públicos. Prohibido entrenar un modelo competidor con salidas de Gemini: el LoRA sale de datos propios o abiertos. Usuarios en UE, Reino Unido o Suiza: solo Gemini pago.
6. **No comercial.** Tailscale Personal es para uso no comercial, igual que Vercel Hobby (por eso no está). Si Quimera factura: Headscale en Micro A y revisar cada plan.
7. **Repo público, cero secretos en git.** Todo vive en OpenBao con auto-unseal en OCI Vault.
8. **Free no es producción.** Aiven lo aclara y puede mover el servicio de nube; ningún plan gratis trae SLA.

## 6. Qué se rompe primero

Ordenado por probabilidad. Cada falla tiene una respuesta automática o un procedimiento ya escrito.

| Falla | Probabilidad | Respuesta |
| --- | --- | --- |
| Groq sin tokens del día | alta · diaria | LiteLLM salta a Gemini, luego OpenRouter, luego Ollama local. |
| Un proveedor cierra su free | alta | Ya pasó en 2026 con Cerebras y GitHub Models. En LiteLLM es una línea de configuración. |
| Qdrant suspendido | media | Pasa tras 1 semana sin uso. La API sigue con BM25 y vector search de ADB; un CronJob reindexa. |
| Oracle sin capacidad para A1 | media | OpenTofu reintenta en otro dominio de disponibilidad. Pay As You Go es una de las salidas que documenta Oracle. |
| Oracle recorta otra vez | media | Ya pasó en junio de 2026. Tamaños parametrizados en OpenTofu; el control plane gestionado no consume RAM. |
| Se cae OKE entero | baja | El Worker deriva a Cloud Run, después a Container Apps y, si todo cae, a Vectorize con caché vencida. |
| Aiven mueve un servicio | baja | Endpoints en OpenBao; External Secrets refresca sin redeploy. |
| GCP pasa 1 GB de egress | baja | Alerta de presupuesto en USD 1 y sondas espaciadas. |

## 7. Lo que quedó afuera

Servicios que muchas guías todavía recomiendan y que hoy no cierran.

| Servicio | Por qué no |
| --- | --- |
| Cerebras | El free tier abierto terminó el 21 de julio de 2026; hoy hay un crédito inicial de USD 5. |
| GitHub Models | Según reportes, retirado el 30 de julio de 2026. |
| HF Spaces CPU Basic | El hardware de 2 vCPU y 16 GB no cobra por hora, pero crear Spaces con cómputo ahora exige plan pago. Lo gratis son los Spaces estáticos y hasta 2 en ZeroGPU. |
| Vercel Hobby | Solo uso personal no comercial. Cloudflare Pages cubre el frontend. |
| Supabase | Pausa los proyectos tras 1 semana sin actividad; 500 MB de base. |
| Render | Duerme a los 15 minutos sin tráfico y tarda ~1 minuto en despertar. |
| Koyeb | 0,1 vCPU, escala a cero tras 1 hora y pide retención en la tarjeta. Desde 2026 es de Mistral. |
| GKE y AKS | El control plane no cuesta (o lo cubre un crédito), pero los nodos se pagan. |
| Amazon S3 5 GB | Era parte del tier de 12 meses; las cuentas nuevas desde julio de 2025 no lo tienen. |
| IBM COS Lite | El plan Lite sin vencimiento quedó deprecado. Cloudant Lite (1 GB) sigue y sirve como extra opcional. |

## 8. Orden de armado

La secuencia importa: la home region de Oracle no se cambia después.

1. Elegí la home region de Oracle (acá, `us-ashburn-1`): Always Free y Autonomous DB solo existen ahí. Pasá a Pay As You Go y creá la alerta de USD 1.
2. Repo público con OpenTofu (providers `oci`, `google`, `azurerm`, `aws`, `cloudflare`, `aiven`) y estado remoto en R2.
3. OCI: VCN privada con NAT, OKE Basic con dos nodos A1 de 1 OCPU / 6 GB, las dos micros, dos Autonomous DB, Vault y bucket.
4. Bootstrap con Argo CD (app-of-apps): Traefik, cloudflared, OpenBao con External Secrets, Kyverno y Alloy.
5. Cloudflare: zona, Tunnel con dos conectores, Access, Pages, Worker con Durable Objects, Queue, R2 y Vectorize.
6. Datos externos: Qdrant, Neo4j, Aiven (Kafka, OpenSearch, PostgreSQL), Upstash, Cosmos DB (el free tier se activa al crear la cuenta), DynamoDB y BigQuery.
7. IA: LiteLLM con la cadena de fallbacks y los cupos de cada proveedor, Ollama con un modelo chico y Langfuse.
8. Réplicas en Cloud Run y Container Apps, y health checks en el Worker.
9. Observabilidad, sondas desde GCP, backups restic y un simulacro: apagá OKE y mirá cómo responde el failover.

## 9. Fuentes

Cupos verificados entre julio y octubre de 2026. Los free tiers cambian seguido: revisá antes de crear cada cuenta.

- [Linuxiac · Oracle recorta A1 a la mitad](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/)
- [issoh · Oracle Free Tier a oct-2026](https://www.issoh.co.jp/tech/details/17531/)
- [Oracle · Free Tier (docs)](https://docs.cloud.oracle.com/Content/FreeTier/freetier.htm)
- [Oracle · Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)
- [Oracle · Autonomous DB 23ai Always Free](https://blogs.oracle.com/datawarehousing/post/23ai-autonomous-database-free)
- [OKE Basic gratis con A1](https://dev.to/ronilsonalves/how-to-deploy-a-free-kubernetes-cluster-with-oracle-cloud-always-free-tier-29o4)
- [Reclamo por inactividad en Oracle](https://standardcompute.com/guides/run-openclaw-on-oracle-cloud-free-tier)
- [Pay As You Go evita el reclamo](https://blog.51sec.org/2023/02/oracle-cloud-cleaning-up-idle-compute.html)
- [GCP Always Free 2026](https://agentdeals.dev/gcp-free-tier-2026)
- [AWS, Azure, GCP e IBM comparados](https://freetier.co/articles/cloud-provider-free-tiers-2026)
- [AWS Free Tier 2026](https://landingpage.spot.rackspace.com/blog/aws-free-tier)
- [Azure · servicios siempre gratis](https://azure.microsoft.com/en-in/free/python)
- [Azure Cosmos DB free tier](https://learn.microsoft.com/azure/cosmos-db/free-tier)
- [Cloudflare · planes](https://www.cloudflare.com/plans.md)
- [Cloudflare Workers · límites](https://developers.cloudflare.com/workers/platform/limits)
- [Cloudflare Queues en el plan free](https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/)
- [Workers AI · precios](https://developers.cloudflare.com/workers-ai/platform/pricing)
- [Cloudflare Zero Trust · planes](https://www.cloudflare.com/plans/sase-zero-trust.md)
- [Qdrant Cloud · cluster free](https://qdrant.tech/documentation/cloud/create-cluster/)
- [Neo4j Aura · cuotas](https://neo4j.com/docs/aura/quotas-and-limits/)
- [Upstash · free tier](https://upstash.com/blog/upstash-vs-aws-elasticache-serverless-redis-pricing-and-performance-2026)
- [Aiven Kafka free tier](https://aiven.io/docs/products/kafka/free-tier/kafka-free-tier)
- [Aiven · límites free](https://freetier.co/directory/products/aiven)
- [Backblaze B2 · precios 2026](https://upstash.com/blog/backblaze-b2-pricing-explained-2026)
- [Hugging Face Spaces](https://huggingface.co/docs/hub/en/spaces-overview)
- [Groq · límites por modelo](https://blogs.novita.ai/free-llm-api-comparison-2026/)
- [Gemini API · free tier 2026](https://yingtu.ai/en/blog/google-gemini-api-free-tier-limits-2026)
- [Gemini API · términos](https://ai.google.dev/gemini-api/terms_preview)
- [APIs de LLM gratis comparadas](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/)
- [OpenRouter · modelos free](https://benchlm.ai/md/free-tier/openrouter.md)
- [Cerebras · fin del free tier](https://claudelog.com/faqs/is-cerebras-free/)
- [GitHub Models · retiro](https://fast.io/resources/github-models-rate-limit/)
- [Colab · FAQ y restricciones](https://research.google.com/colaboratory/faq.html)
- [GitHub Actions · runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub · términos de Actions](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)
- [Grafana Cloud · free tier](https://last9.io/blog/grafana-cloud-pricing/)
- [Sentry · plan Developer](https://toolradar.com/tools/sentry/pricing)
- [Langfuse · plan Hobby](https://www.zenml.io/blog/langfuse-pricing)
- [Tailscale · plan Personal](https://www.ssdnodes.com/learn/is-tailscale-free-plan-limits)
- [Resend · precios](https://superdupr.com/blog/resend-pricing)
- [Vercel Hobby · no comercial](https://vercel.com/docs/plans/hobby-plan)
- [Supabase · free tier](https://makerkit.dev/blog/saas/supabase-pricing)
- [Koyeb · cambios 2026](https://snapdeploy.dev/koyeb-alternative)
- [Render y Koyeb · hosting free](https://freetier.co/articles/best-free-cloud-hosting-2026)

Las cifras de RAM por nodo, capacidad de Qdrant y Autonomous DB son estimaciones propias de diseño. OKE Basic no figura formalmente en Always Free.
