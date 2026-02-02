/**
 * Reconnection Test Script
 * 
 * Tests the automatic reconnection capability of AMI and ARI clients
 * when the Asterisk service restarts.
 * 
 * Usage: npm run test:reconnect
 */

import 'dotenv/config';
import { AMIClient } from '../src/services/ami-client.js';
import { ARIClient } from '../src/services/ari-client.js';
import { logger } from '../src/utils/logger.js';

class ReconnectionTester {
    constructor() {
        this.amiClient = null;
        this.ariClient = null;
        this.amiReconnections = 0;
        this.ariReconnections = 0;
    }

    async run() {
        logger.info('═══════════════════════════════════════════════════');
        logger.info('  Reconnection Test Script');
        logger.info('═══════════════════════════════════════════════════');
        logger.info('');
        logger.info('This script tests automatic reconnection capabilities.');
        logger.info('It will connect to AMI/ARI and monitor for disconnections.');
        logger.info('');
        logger.info('To test reconnection:');
        logger.info('  1. Let this script connect successfully');
        logger.info('  2. Restart Asterisk: sudo systemctl restart asterisk');
        logger.info('  3. Watch the logs - clients should automatically reconnect');
        logger.info('');
        logger.info('Press Ctrl+C to stop the test.');
        logger.info('═══════════════════════════════════════════════════');

        // Start AMI Client
        await this.testAMI();

        // Start ARI Client
        await this.testARI();

        // Keep running and report status
        this.startStatusReporting();
    }

    async testAMI() {
        logger.info('\n📡 Testing AMI Client...');

        this.amiClient = new AMIClient();

        // Track connection events
        this.amiClient.on('connected', () => {
            this.amiReconnections++;
            logger.info(`✅ AMI Connected (connection #${this.amiReconnections})`);
        });

        this.amiClient.on('disconnected', () => {
            logger.warn('⚠️ AMI Disconnected - waiting for reconnection...');
        });

        this.amiClient.on('error', (error) => {
            logger.error('❌ AMI Error:', error.message);
        });

        // Track call events
        this.amiClient.on('callanswered', (data) => {
            logger.info('📞 [AMI Event] Call Answered:', data);
        });

        this.amiClient.on('hangup', (data) => {
            logger.info('📴 [AMI Event] Call Hangup:', data);
        });

        try {
            await this.amiClient.connect();
        } catch (error) {
            logger.error('AMI connection failed, will retry automatically');
        }
    }

    async testARI() {
        logger.info('\n🎙️ Testing ARI Client...');

        this.ariClient = new ARIClient();

        // Track connection events
        this.ariClient.on('connected', () => {
            this.ariReconnections++;
            logger.info(`✅ ARI Connected (connection #${this.ariReconnections})`);
        });

        this.ariClient.on('disconnected', () => {
            logger.warn('⚠️ ARI Disconnected - waiting for reconnection...');
        });

        this.ariClient.on('error', (error) => {
            logger.error('❌ ARI Error:', error.message);
        });

        // Track Stasis events
        this.ariClient.on('stasisend', (data) => {
            logger.info('🎙️ [ARI Event] Stasis End:', data);
        });

        try {
            await this.ariClient.connect();
        } catch (error) {
            logger.error('ARI connection failed, will retry automatically');
        }
    }

    startStatusReporting() {
        setInterval(() => {
            const amiStatus = this.amiClient?.getStatus() || {};
            const ariStatus = this.ariClient?.getStatus() || {};

            logger.info('═══════════════════════════════════════════════════');
            logger.info('  Connection Status Report');
            logger.info('═══════════════════════════════════════════════════');
            logger.info(`  AMI: ${amiStatus.connected ? '🟢 Connected' : '🔴 Disconnected'}`);
            logger.info(`       Reconnect attempts: ${amiStatus.reconnectAttempts}`);
            logger.info(`       Total connections: ${this.amiReconnections}`);
            logger.info('');
            logger.info(`  ARI: ${ariStatus.connected ? '🟢 Connected' : '🔴 Disconnected'}`);
            logger.info(`       Reconnect attempts: ${ariStatus.reconnectAttempts}`);
            logger.info(`       Total connections: ${this.ariReconnections}`);
            logger.info('═══════════════════════════════════════════════════');
        }, 30000); // Report every 30 seconds
    }

    async shutdown() {
        logger.info('\nShutting down test...');
        
        if (this.amiClient) {
            await this.amiClient.disconnect();
        }
        if (this.ariClient) {
            await this.ariClient.disconnect();
        }

        logger.info('Test complete.');
        logger.info(`Total AMI connections: ${this.amiReconnections}`);
        logger.info(`Total ARI connections: ${this.ariReconnections}`);
        
        process.exit(0);
    }
}

// Run the test
const tester = new ReconnectionTester();

process.on('SIGINT', () => tester.shutdown());
process.on('SIGTERM', () => tester.shutdown());

tester.run().catch((error) => {
    logger.error('Test failed:', error);
    process.exit(1);
});
