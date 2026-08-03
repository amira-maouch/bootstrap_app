# V9 streaming baseline — 2026-08-02

Environment: local production build, `http://localhost:3101/login`, headless
Chrome, three samples per mode. The fake API was intentionally offline, so the
login loader exercised its non-fatal fallback; this is a streaming-core
baseline, not the loader-data comparison.

| Mode | Median TTFB | Median FCP | Median LCP | HTML bytes | Server prepare | Server shell |
| ---- | ----------: | ---------: | ---------: | ---------: | -------------: | -----------: |
| Cold |     25.4 ms |     112 ms |     112 ms |     17,034 |         1.4 ms |      10.0 ms |
| Warm |     23.3 ms |     112 ms |     112 ms |     17,034 |         1.3 ms |       9.4 ms |

Command:

```sh
HERON_BENCHMARK_VARIANTS='[{"name":"streaming-core","url":"http://localhost:3101/login"}]' \
HERON_BENCHMARK_SAMPLES=3 \
pnpm benchmark:ssr
```

This does not authorize a broader rollout. Repeat with stable CSR, core SSR,
universal-component SSR, authenticated loader SSR, and streaming deployments;
compare cold/warm medians plus server heap/handle trends and mismatch/error
rates before changing the SSR route allowlist.
