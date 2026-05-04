# Frontend

This directory contains the Vite + React + TypeScript single-page app for KernelBench.

## Purpose

The frontend has three jobs:

- launch and monitor live benchmark runs
- manage queued CPU/GPU work
- visualize historical CPU and GPU results on shared charts

It talks only to the backend JSON-RPC endpoint at `POST /api`.

## Architecture Decisions

- Single-page app behind CloudFront: the frontend is deployed as static assets to S3 and served through CloudFront.
- JSON-RPC instead of path-based REST: the app sends `jsonrpc: "2.0"` requests with method names like `startRun` and `historyVector`.
- Top-level product tabs: the UI is split into `Benchmark`, `Performance`, and `History`.
- Benchmark tabs inside `Benchmark`: vector, matrix multiplication, and convolution are tabbed instead of collapsible.
- Queue management: queued runs can be viewed, deleted, and reordered before dispatch.
- Lazy performance/history bundles: charting and run-history code are loaded only when those tabs are opened.
- Shared CPU/GPU charts: the historical view overlays CPU and GPU data on the same axes for direct comparison.

## Current UI Model

### Benchmark Tab

The `Benchmark` tab contains benchmark-specific forms for:

- vector
- matrix multiplication
- convolution

Each section:

- launches CPU and GPU runs for side-by-side comparison
- shows current instance state badges next to result headings
- queues work when the selected runner is already busy
- polls live run status until completion

It also shows a queued-runs card backed by `listInProgressRuns`, `deleteQueuedRun`, and `reorderQueuedRuns`.

### Performance Tab

The `Performance` tab shows charted run history backed by DynamoDB history records.

- Vector: scatter chart with `N` on the X axis and operation duration in `ms` on the Y axis.
- Matrix multiplication: square-only history (`inputRows = inputCols = outputCols`) with size on X and duration in `ms` on Y.
- Convolution: shared CPU/GPU historical chart using normalized convolution dimensions already returned by the backend.

### History Tab

The `History` tab shows a sortable table of completed and failed runs returned by `runHistory`.

## API Integration

Main client module: [api.ts](/Users/umairansari/projects/gpu-compute-framework/frontend/src/lib/api.ts)

Implemented JSON-RPC methods:

- `startRun`
- `deleteQueuedRun`
- `reorderQueuedRuns`
- `getRunStatus`
- `listInProgressRuns`
- `getInstanceStates`
- `historyVector`
- `historyMatmul`
- `historyConvolution`
- `runHistory`

If `VITE_API_BASE_URL` is unset, the frontend calls relative `/api` on the current origin. For local development against the deployed backend, set:

```bash
VITE_API_BASE_URL=https://<cloudfront-domain>
```

## Layout

- `src/App.tsx`
  Top-level app shell, theme toggle, `Benchmark | Performance | History` tabs, and live run orchestration.
- `src/HistoricalView.tsx`
  Lazy-loaded performance charts and filters.
- `src/RunHistoryView.tsx`
  Lazy-loaded sortable table of terminal runs.
- `src/benchmarks/benchmarkRegistry.ts`
  Frontend benchmark labels, tabs, keys, and parameter formatting.
- `src/lib/api.ts`
  JSON-RPC client, React Query hooks, and response types.
- `src/components/`
  Form sections, status cards, tab buttons, and tests.
- `src/components/aceternity/`
  Local Aceternity-style visual primitives.
- `public/`
  Static assets like the favicon.

## Local Development

Install and run:

```bash
cd frontend
npm install
npm run dev
```

Optional local env:

```bash
VITE_API_BASE_URL=https://<cloudfront-domain>
```

Build:

```bash
npm run build
```

## Deployment

Build output is written to `frontend/dist`.

Manual deployment helper:

```bash
./infrastructure/scripts/upload-frontend.sh <frontend-bucket-name> ./frontend
```

That script:

- runs `npm run build`
- syncs `dist/` to the frontend bucket

CloudFront invalidation is handled separately in manual deployments and automatically in GitHub Actions.

## Relevant Tests

The directory includes focused component tests such as:

- `VectorSection.test.tsx`
- `MatmulSection.test.tsx`
- `ConvolutionSection.test.tsx`
- `RunStatusCard.test.tsx`
- `HistoryTabButton.test.tsx`

## Notes

- Historical charting uses `Recharts`.
- The performance and history code paths are intentionally split out to reduce the initial JS bundle size for the default `Benchmark` experience.
- The frontend does not implement user auth; backend access control currently relies on origin verification and infrastructure boundaries.
