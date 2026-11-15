import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { ensureDatabaseSchema } from './src/db/bootstrap.ts';
import { getSqlConnectionConfig, pool } from './src/db/index.ts';
import { getPublicFirebaseConfig } from './src/lib/firebase-config.ts';
import { archiveRouter } from './src/server/routes/archive.ts';
import { metadataRouter } from './src/server/routes/metadata.ts';
import { microsoftRouter } from './src/server/routes/microsoft.ts';
import { userRouter } from './src/server/routes/user.ts';
import { wordSessionsRouter } from './src/server/routes/wordSessions.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  await ensureDatabaseSchema();

  const app = express();

  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.json({ limit: '15mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api', apiLimiter);

  app.get('/api/health', async (_req, res) => {
    const cfg = getSqlConnectionConfig();
    if (!cfg.host || !cfg.database) {
      return res.json({
        ok: true,
        service: 'personal-drive-os',
        database: 'unconfigured',
      });
    }
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, service: 'personal-drive-os', database: 'connected' });
    } catch (err: any) {
      res.json({
        ok: true,
        service: 'personal-drive-os',
        database: 'disconnected',
        error: err?.message || 'Database unavailable',
      });
    }
  });

  app.get('/api/health/db', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, database: 'connected' });
    } catch (err: any) {
      res.status(503).json({
        ok: false,
        database: 'disconnected',
        error: err?.message || 'Database unavailable',
      });
    }
  });

  app.get('/api/config/firebase', (_req, res) => {
    const cfg = getPublicFirebaseConfig();
    if (!cfg.apiKey || !cfg.projectId) {
      return res.status(500).json({
        error:
          'Firebase is not configured. Set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, and FIREBASE_APP_ID in your Environment Variables.',
      });
    }
    res.json(cfg);
  });

  app.use('/api/user', userRouter);
  app.use('/api/metadata', metadataRouter);
  app.use('/api/archive', archiveRouter);
  app.use('/api/microsoft', microsoftRouter);
  app.use('/api/word-sessions', wordSessionsRouter);

  if (process.env.NODE_ENV !== 'production') {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Personal Drive OS listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Personal Drive OS server:', err);
  process.exit(1);
});
