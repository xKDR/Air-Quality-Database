# aqi-api gateway (Cloudflare Worker)

Public entry point for the India Air Quality API: API keys in D1, self-serve signup with email
magic links and Turnstile, per-key rate limits, bulk Parquet from R2, and a proxy to the query service.

* Deploy and operations: [../docs/DEPLOY_API.md](../docs/DEPLOY_API.md)
* User-facing docs: [../docs/PUBLIC_API.md](../docs/PUBLIC_API.md)

```bash
npm install
npm run typecheck
npm run migrate:local && npm run dev        # local: http://127.0.0.1:8787 (needs .dev.vars, see .dev.vars.example)
npm run migrate:remote && npm run deploy    # production
npm run tail                                # live logs (verification links when EMAIL_PROVIDER=log)
```

Routes: `/` docs · `/signup` · `/verify` · `/admin/*` · `/v1/files/<key>` (R2) · `/v1/*` (origin).
Source layout: `src/index.ts` router → `signup.ts`, `admin.ts`, `proxy.ts`; `keys.ts` key store; `pages.ts` HTML.
