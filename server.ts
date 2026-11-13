import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createServer as createViteServer } from 'vite';
import type { AIProviderType, DiagnosticReport } from './src/shared/contracts.ts';
import { KARNATAKA_DISTRICTS } from './src/shared/contracts.ts';
import { requireExpertRole, signRoleToken } from './server/auth.ts';
import {
  createCrop,
  db,
  getCropById,
  getScanById,
  insertScan,
  listCrops,
  listExpertReviews,
  listOutbreaks,
  listScans,
  submitExpertReview,
} from './server/db.ts';
import { createAIProvider } from './server/providers.ts';
import { getDistrictEnvironmentalInsights, getDistrictWeather } from './server/weather.ts';

const AnalyzeSchema = z.object({
  clientScanId: z.string().min(4).max(120),
  imageDataUrl: z.string().min(10).max(6_500_000),
  cropId: z.string().nullable().optional(),
  cropHint: z.string().max(80).optional(),
  scenarioKey: z.string().max(80).optional(),
  district: z.string().min(2).max(80).default('Mandya'),
  providerOverride: z.enum(['mock', 'external', 'native_ml']).optional(),
});

const CreateCropSchema = z.object({
  name: z.string().min(2).max(100),
  cropType: z.string().min(2).max(60),
  variety: z.string().min(1).max(80).default('Local Cultivar'),
  district: z.string().min(2).max(80).default('Mandya'),
  plantedAt: z.string().min(4).max(40),
  areaAcres: z.number().min(0.1).max(1000).default(1.0),
  notes: z.string().max(400).default(''),
});

const ExpertReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'corrected']),
  correctedCrop: z.string().max(80).optional(),
  correctedDisease: z.string().max(120).optional(),
  correctedSeverityPercent: z.number().min(0).max(100).optional(),
  notes: z.string().min(3).max(800),
});

const RoleSessionSchema = z.object({
  role: z.enum(['farmer', 'expert']),
});

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/v1/health', (_req, res) => {
    const provider = createAIProvider();
    res.json({
      status: 'ok',
      service: 'sasya-mitra-api',
      aiProvider: provider.id,
      modelVersion: provider.modelVersion,
      isSimulated: provider.isSimulated,
      weatherProvider: process.env.WEATHER_PROVIDER || 'open-meteo',
      database: 'sqlite',
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/v1/auth/role-session', (req, res) => {
    const parsed = RoleSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid role selection', details: parsed.error.flatten() });
      return;
    }

    const session =
      parsed.data.role === 'expert'
        ? {
            role: 'expert' as const,
            displayName: 'Dr. Kavitha Rao',
            institution: 'UAS Bengaluru · Plant Pathology',
            issuedAt: Date.now(),
          }
        : {
            role: 'farmer' as const,
            displayName: 'Ramesh Gowda',
            institution: 'Mandya FPO Member',
            issuedAt: Date.now(),
          };

    const token = signRoleToken(session);
    res.json({ token, session });
  });

  app.post('/api/v1/diagnosis/analyze', async (req, res) => {
    const parsed = AnalyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid scan payload', details: parsed.error.flatten() });
      return;
    }

    const input = parsed.data;
    const districtObj =
      KARNATAKA_DISTRICTS.find((d) => d.name === input.district) || KARNATAKA_DISTRICTS[0];

    try {
      const weather = await getDistrictWeather(districtObj.name);
      const provider = createAIProvider(input.providerOverride as AIProviderType | undefined);
      const result = await provider.analyze({
        imageDataUrl: input.imageDataUrl,
        cropHint: input.cropHint,
        scenarioKey: input.scenarioKey,
        district: districtObj.name,
        conditions: weather.conditions,
      });

      const now = new Date().toISOString();
      const scanId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const report: DiagnosticReport = {
        id: scanId,
        clientScanId: input.clientScanId,
        cropId: input.cropId || null,
        cropName: result.cropName,
        diseaseName: result.diseaseName,
        scientificName: result.scientificName,
        confidence: result.confidence,
        severityPercent: result.severityPercent,
        severityCategory: result.severityCategory,
        lesionMask: result.lesionMask,
        symptoms: result.symptoms,
        diseaseExplanation: result.diseaseExplanation,
        environmentalRisk: result.environmentalRisk,
        recommendations: result.recommendations,
        modelVersion: result.modelVersion,
        providerId: result.providerId,
        isSimulated: result.isSimulated,
        expertStatus: 'pending',
        expertCorrection: null,
        district: districtObj.name,
        latitude: districtObj.latitude,
        longitude: districtObj.longitude,
        imageUrl: input.imageDataUrl,
        scenarioKey: result.scenarioKey,
        createdAt: now,
        syncedAt: now,
      };

      const persisted = insertScan(report);
      res.status(201).json(persisted);
    } catch (err) {
      res.status(500).json({
        error: 'Diagnosis inference failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  app.get('/api/v1/history', (req, res) => {
    const cropId = typeof req.query.cropId === 'string' ? req.query.cropId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const district = typeof req.query.district === 'string' ? req.query.district : undefined;
    res.json({ scans: listScans({ cropId, status, district }) });
  });

  app.get('/api/v1/scans/:scanId', (req, res) => {
    const scan = getScanById(req.params.scanId);
    if (!scan) {
      res.status(404).json({ error: 'Diagnostic report not found' });
      return;
    }
    res.json(scan);
  });

  app.get('/api/v1/crops', (_req, res) => {
    res.json({ crops: listCrops() });
  });

  app.post('/api/v1/crops', (req, res) => {
    const parsed = CreateCropSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid crop profile', details: parsed.error.flatten() });
      return;
    }
    const id = `crop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const crop = createCrop({ id, ...parsed.data });
    res.status(201).json(crop);
  });

  app.get('/api/v1/crops/:cropId', (req, res) => {
    const found = getCropById(req.params.cropId);
    if (!found) {
      res.status(404).json({ error: 'Crop profile not found' });
      return;
    }
    res.json(found);
  });

  app.get('/api/v1/insights', async (req, res) => {
    const district = typeof req.query.district === 'string' ? req.query.district : 'Mandya';
    const insights = await getDistrictEnvironmentalInsights(district);
    res.json(insights);
  });

  app.get('/api/v1/outbreaks', (req, res) => {
    const crop = typeof req.query.crop === 'string' ? req.query.crop : undefined;
    const district = typeof req.query.district === 'string' ? req.query.district : undefined;
    const verifiedOnly = req.query.verifiedOnly === 'true';
    res.json({
      reports: listOutbreaks({ crop, district, verifiedOnly }),
      districts: KARNATAKA_DISTRICTS,
    });
  });

  app.get('/api/v1/expert/queue', requireExpertRole, (_req, res) => {
    res.json({
      scans: listScans(),
      reviews: listExpertReviews(),
    });
  });

  app.post('/api/v1/expert-review/:scanId', requireExpertRole, (req, res) => {
    const parsed = ExpertReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid review payload', details: parsed.error.flatten() });
      return;
    }
    const expertSession = (req as express.Request & { expertSession?: { displayName: string } }).expertSession;
    const updated = submitExpertReview({
      scanId: req.params.scanId,
      reviewerName: expertSession?.displayName || 'Dr. Kavitha Rao',
      decision: parsed.data.decision,
      correctedCrop: parsed.data.correctedCrop,
      correctedDisease: parsed.data.correctedDisease,
      correctedSeverityPercent: parsed.data.correctedSeverityPercent,
      notes: parsed.data.notes,
    });
    if (!updated) {
      res.status(404).json({ error: 'Scan not found' });
      return;
    }
    res.json(updated);
  });

  app.post('/api/v1/feedback', (req, res) => {
    const scanId = typeof req.body?.scanId === 'string' ? req.body.scanId : '';
    const helpful = Boolean(req.body?.helpful);
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.slice(0, 400) : '';
    if (!scanId) {
      res.status(400).json({ error: 'scanId is required' });
      return;
    }
    res.status(201).json({
      recorded: true,
      scanId,
      helpful,
      comment,
      recordedAt: new Date().toISOString(),
    });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Ensure DB initialized cleanly
  db.prepare('SELECT 1').get();

  app.listen(port, '0.0.0.0', () => {
    console.log(`Sasya Mitra full-stack server listening on http://0.0.0.0:${port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}` || !process.env.VITEST) {
  // Only start listener when invoked as main entry (not during unit tests)
  const distExists = fs.existsSync(path.resolve(process.cwd(), 'dist'));
  if (process.env.NODE_ENV !== 'test' && (process.argv[1]?.endsWith('server.ts') || distExists || !process.env.VITEST)) {
    startServer();
  }
}
