#!/usr/bin/env node

/**
 * Standalone Forge API Server
 * 
 * This server runs continuously to provide real-time deployment statistics,
 * health checks, and monitoring capabilities for the Forge platform.
 * 
 * Usage:
 *   node dist/server.js
 *   pm2 start dist/server.js --name forge-api-server
 */

import { ForgeAPIServer } from './services/apiServer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

async function startServer() {
  try {
    console.log(chalk.blue.bold('🚀 Starting Forge API Server...'));
    console.log();

    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'logs');
    await fs.ensureDir(logsDir);

    // Setup graceful shutdown
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    process.on('uncaughtException', (error) => {
      console.error(chalk.red('Uncaught Exception:'), error);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason, promise) => {
      console.error(chalk.red('Unhandled Rejection at:'), promise, 'reason:', reason);
      process.exit(1);
    });

    // Start the API server
    const apiServer = new ForgeAPIServer();
    await apiServer.start();

    console.log();
    console.log(chalk.green('✅ Forge API Server is running'));
    console.log(chalk.gray('Press Ctrl+C to stop'));
    console.log();
    console.log(chalk.cyan('Available endpoints:'));
    console.log(chalk.gray('  GET  /health                     - Server health check'));
    console.log(chalk.gray('  GET  /api/deployments            - List all deployments'));
    console.log(chalk.gray('  GET  /api/deployments/:id        - Get deployment details'));
    console.log(chalk.gray('  POST /api/deployments/:id/stop   - Stop deployment'));
    console.log(chalk.gray('  GET  /api/system                 - System information'));
    console.log();

    // Keep the process alive
    setInterval(() => {
      // Heartbeat log every 5 minutes
      console.log(chalk.gray(`[${new Date().toISOString()}] API Server heartbeat`));
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error(chalk.red('Failed to start API server:'), error);
    process.exit(1);
  }
}

function gracefulShutdown(signal: string) {
  console.log();
  console.log(chalk.yellow(`Received ${signal}. Shutting down gracefully...`));
  
  // Give some time for ongoing requests to complete
  setTimeout(() => {
    console.log(chalk.gray('Forge API Server stopped'));
    process.exit(0);
  }, 2000);
}

// Start the server
startServer();
