/**
 * AI-PBX Gateway - Main Entry Point
 * 
 * This service bridges FreePBX/Asterisk with AI processing capabilities
 * through AMI (event tracking) and ARI (voice pipeline) interfaces.
 */

import 'dotenv/config';
import { logger } from './utils/logger.js';
import { initDatabase } from './database/init.js';
import { AMIClient } from './services/ami-client.js';
import { ARIClient } from './services/ari-client.js';
import { createAPIServer } from './api/server.js';

class AIGateway {
    constructor() {
        this.amiClient = null;
        this.ariClient = null;
        this.apiServer = null;
        this.isShuttingDown = false;
    }

    async start() {
        logger.info('🚀 Starting AI-PBX Integration Gateway...');

        try {
            // Initialize database
            logger.info('📦 Initializing database...');
            await initDatabase();

            // Start AMI Client for real-time event tracking
            logger.info('📡 Connecting to AMI...');
            this.amiClient = new AMIClient();
            try {
                await this.amiClient.connect();
            } catch (amiError) {
                logger.warn('⚠️ AMI connection failed - continuing without AMI', { 
                    error: amiError.message 
                });
                logger.warn('   (This is normal if Asterisk is not running locally)');
            }

            // Start ARI Client for voice-to-AI pipeline
            logger.info('🎙️ Connecting to ARI...');
            this.ariClient = new ARIClient();
            try {
                await this.ariClient.connect();
            } catch (ariError) {
                logger.warn('⚠️ ARI connection failed - continuing without ARI', { 
                    error: ariError.message 
                });
                logger.warn('   (This is normal if Asterisk is not running locally)');
            }

            // Start API Server
            logger.info('🌐 Starting API server...');
            const app = createAPIServer();
            const port = process.env.PORT || 3000;
            this.apiServer = app.listen(port, () => {
                logger.info(`✅ API Server running on http://localhost:${port}`);
            });

            logger.info('✨ AI-PBX Gateway started successfully!');
            this.logServiceStatus();

        } catch (error) {
            logger.error('Failed to start AI-PBX Gateway:', error);
            await this.shutdown(1);
        }
    }

    logServiceStatus() {
        logger.info('═══════════════════════════════════════════');
        logger.info('  AI-PBX Integration Gateway Status');
        logger.info('═══════════════════════════════════════════');
        logger.info(`  AMI: ${this.amiClient?.isConnected ? '🟢 Connected' : '🔴 Disconnected'}`);
        logger.info(`  ARI: ${this.ariClient?.isConnected ? '🟢 Connected' : '🔴 Disconnected'}`);
        logger.info(`  API: http://localhost:${process.env.PORT || 3000}`);
        logger.info('═══════════════════════════════════════════');
        logger.info('  Endpoints:');
        logger.info('  - GET  /health     - Health check');
        logger.info('  - GET  /calls      - Call history with transcription status');
        logger.info('  - GET  /calls/:id  - Specific call details');
        logger.info('  - GET  /status     - Service connection status');
        logger.info('═══════════════════════════════════════════');
    }

    async shutdown(exitCode = 0) {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        logger.info('🛑 Shutting down AI-PBX Gateway...');

        try {
            if (this.amiClient) {
                await this.amiClient.disconnect();
            }
            if (this.ariClient) {
                await this.ariClient.disconnect();
            }
            if (this.apiServer) {
                this.apiServer.close();
            }
            logger.info('👋 Goodbye!');
        } catch (error) {
            logger.error('Error during shutdown:', error);
        }

        process.exit(exitCode);
    }
}

// Create and start the gateway
const gateway = new AIGateway();

// Handle graceful shutdown
process.on('SIGINT', () => gateway.shutdown());
process.on('SIGTERM', () => gateway.shutdown());
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // Don't exit on connection refused errors (development mode)
    if (error.code !== 'ECONNREFUSED') {
        gateway.shutdown(1);
    }
});
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the gateway
gateway.start();

export { gateway };
