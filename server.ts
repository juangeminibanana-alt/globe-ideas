import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createFastTrackRouter } from './server/fastTrackAdapter';
import { createProductWorldRouter } from './server/productWorldCatalog';

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/fast-track', createFastTrackRouter());
  app.use('/api/product-worlds', createProductWorldRouter());

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_request, response) => {
      response.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Product World ready at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Unable to start Product World:', error);
  process.exitCode = 1;
});
