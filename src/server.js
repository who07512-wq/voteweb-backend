require('dotenv').config();
const app = require('./app');
const config = require('./config');
const db = require('./db');

const PORT = config.port || 3000;

const server = app.listen(PORT, () => {
  console.log(`VoteWeb API server running on port ${PORT}`);
  console.log(`Environment: ${config.env}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Database health: http://localhost:${PORT}/api/health/db`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\nReceived shutdown signal...');

  server.close(async () => {
    console.log('HTTP server closed.');

    try {
      await db.close();
      console.log('Graceful shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err.message);
      process.exit(1);
    }
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
