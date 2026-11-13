# Sasya Mitra — Agricultural Disease Intelligence Platform

**Tagline:** *Your Smart Companion for Healthier Crops.*

Sasya Mitra is a mobile-first, offline-capable Progressive Web App (PWA) built for Indian farmers and agricultural extension experts. It connects computer-vision leaf scanning, independent lesion-area severity estimation, longitudinal plant progression tracking, Open-Meteo meteorological risk modeling, Karnataka outbreak mapping, and human-in-the-loop expert verification behind a replaceable AI inference architecture.

---

## Key Modules & Routes

| Route | Module | Capability |
| :--- | :--- | :--- |
| `/` | Intelligent Scanner | Live WebRTC camera with calibrated reticle, validated & compressed gallery upload, and 7 reproducible Demo Mode scenarios |
| `/preview` | Specimen Preview | Links scan to tracked crop plots in *My Crops*, assigns Karnataka district, or saves to offline sync queue |
| `/analyzing` | Diagnostic Scan | Animated corner brackets, sweeping laser visual, progressive steps, and network-resilient queuing |
| `/report/:scanId` | Diagnostic Report | Interactive lesion mask overlay, independent Confidence & Severity gauges, weather suitability, and verified ICAR/UAS advisories |
| `/crops` & `/crops/:plantId` | My Crops & Progression | Plot management with Recharts severity trends (`Improving`, `Worsening`, `Stable`, `Insufficient Data`) |
| `/history` | Scan Archive | Local & synced history with Dexie IndexedDB pending-scan sync queue |
| `/insights` | Weather Intelligence | Live Open-Meteo forecasts + disease-specific suitability risk matrix (with simulated fallback when offline) |
| `/outbreaks` | Outbreak Map | Interactive Karnataka Leaflet map with spatial clusters distinguishing simulated vs. expert-verified reports |
| `/expert` | Expert Verification | Role-protected Agronomist review queue to approve, reject, or override diagnoses and record ML retraining feedback |
| `/profile` | Settings & Offline | English / हिन्दी / ಕನ್ನಡ switcher, Daylight/Dark toggle, Demo Role switcher, AI Provider selector, and PWA install |

---

## Replaceable AI Provider Architecture

Inference is decoupled behind a unified `AIProvider` interface (`server/providers.ts`) controlled via `AI_PROVIDER`:

- `AI_PROVIDER=mock` *(Default)*: Deterministic pathology scenarios with simulated lesion masks (`isSimulated: true`).
- `AI_PROVIDER=external`: Forwards specimen images to `EXTERNAL_AI_ENDPOINT` (`EXTERNAL_AI_API_KEY`) and normalizes results.
- `AI_PROVIDER=native_ml`: Connects directly to our trained PyTorch / TensorFlow / YOLOv8-seg service (`NATIVE_ML_ENDPOINT`), with a standalone FastAPI parity reference in `backend/main.py`.

Switching from `mock` to `native_ml` requires **zero frontend code changes**.

---

## API Contracts (`/api/v1/*`)

- `GET /api/v1/health` — Active provider identity, model version, and weather/database status.
- `POST /api/v1/auth/role-session` — Issues HMAC-signed role session tokens (`farmer` | `expert`).
- `POST /api/v1/diagnosis/analyze` — Idempotent leaf analysis (`clientScanId`) returning normalized `DiagnosticReport`.
- `GET /api/v1/history` & `GET /api/v1/scans/:scanId` — Retrieve diagnostic archive and single reports.
- `GET/POST /api/v1/crops` & `GET /api/v1/crops/:cropId` — Manage crop plots and progression timelines.
- `GET /api/v1/insights?district=...` — Live Open-Meteo telemetry + crop-disease suitability risk.
- `GET /api/v1/outbreaks` — Karnataka outbreak clusters filtered by crop, district, or expert verification.
- `GET /api/v1/expert/queue` & `POST /api/v1/expert-review/:scanId` — Role-protected expert review & ground-truth logging.
- `POST /api/v1/feedback` — Farmer advisory helpfulness feedback.

---

## Local Setup & Commands

```bash
# 1. Install dependencies
npm install

# 2. Start full-stack Express + Vite server on port 3000
npm run dev

# 3. Run TypeScript type check, unit/component tests, and production build
npm run lint
npm test
npm run build

# 4. Run production server
npm start
```

### Standalone Python FastAPI ML Service (Optional)

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```
