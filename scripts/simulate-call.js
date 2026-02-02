/**
 * Call Simulation Script
 * 
 * Simulates call events for testing the middleware without actual PBX.
 * Creates mock call records in the database.
 * 
 * Usage: npm run test:call
 */

import 'dotenv/config';
import { initDatabase } from '../src/database/init.js';
import { CallRepository } from '../src/database/call-repository.js';
import { TranscriptionRepository } from '../src/database/transcription-repository.js';
import { AIProcessor } from '../src/services/ai-processor.js';
import { logger } from '../src/utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

class CallSimulator {
    constructor() {
        this.simulatedCalls = [];
    }

    async run() {
        logger.info('═══════════════════════════════════════════════════');
        logger.info('  Call Simulation Script');
        logger.info('═══════════════════════════════════════════════════');

        // Initialize database
        await initDatabase();
        logger.info('Database initialized');

        // Simulate different scenarios
        await this.simulateNormalCall();
        await this.simulateMissedCall();
        await this.simulateCallWithTranscription();
        await this.simulateMultipleCalls();

        // Display results
        await this.displayResults();
    }

    /**
     * Simulate a normal completed call
     */
    async simulateNormalCall() {
        logger.info('\n📞 Simulating normal call...');

        const uniqueId = uuidv4();
        
        // Step 1: Create call (new channel)
        const callId = await CallRepository.createCall({
            uniqueId,
            callerId: '1001',
            callerName: 'John Doe',
            destination: '1002',
            channel: 'PJSIP/1001-00000001',
            destChannel: 'PJSIP/1002-00000002',
            callState: 'initiated'
        });

        await CallRepository.logCallEvent(callId, 'newchannel', {
            event: 'Newchannel',
            channel: 'PJSIP/1001-00000001'
        });

        await this.delay(500);

        // Step 2: Call answered
        await CallRepository.updateCallAnswered(uniqueId);
        await CallRepository.logCallEvent(callId, 'answered', {
            event: 'Newstate',
            channelstate: 6
        });

        await this.delay(2000); // Simulate 2 second call

        // Step 3: Call ended
        await CallRepository.updateCallEnded(uniqueId, '16', 'Normal Clearing');
        await CallRepository.logCallEvent(callId, 'hangup', {
            event: 'Hangup',
            cause: '16'
        });

        this.simulatedCalls.push({ uniqueId, callId, type: 'normal' });
        logger.info(`✅ Normal call simulated (ID: ${callId})`);
    }

    /**
     * Simulate a missed/unanswered call
     */
    async simulateMissedCall() {
        logger.info('\n📵 Simulating missed call...');

        try {
            const uniqueId = uuidv4();

            // Create call
            logger.info('Creating missed call record...');
            const callId = await CallRepository.createCall({
                uniqueId,
                callerId: '1003',
                callerName: 'Jane Smith',
                destination: '1004',
                channel: 'PJSIP/1003-00000003',
                callState: 'initiated'
            });
            logger.info(`Missed call record created: ${callId}`);

            await CallRepository.logCallEvent(callId, 'newchannel', {
                event: 'Newchannel'
            });

            await this.delay(500); // Short delay for testing

            // Call ended without answer
            await CallRepository.updateCallEnded(uniqueId, '21', 'Call Rejected');
            await CallRepository.logCallEvent(callId, 'hangup', {
                event: 'Hangup',
                cause: '21'
            });

            this.simulatedCalls.push({ uniqueId, callId, type: 'missed' });
            logger.info(`✅ Missed call simulated (ID: ${callId})`);
        } catch (error) {
            // Handle both Error objects and string throws from sql.js
            if (typeof error === 'string') {
                logger.error('Error in simulateMissedCall (string):', error);
            } else {
                logger.error('Error in simulateMissedCall:', { 
                    message: error?.message || 'No message', 
                    stack: error?.stack || 'No stack',
                    errorValue: String(error)
                });
            }
            throw error;
        }
    }

    /**
     * Simulate a call with AI transcription
     */
    async simulateCallWithTranscription() {
        logger.info('\n🤖 Simulating call with AI transcription...');

        const uniqueId = uuidv4();

        // Create call
        const callId = await CallRepository.createCall({
            uniqueId,
            callerId: '1005',
            callerName: 'AI Test Caller',
            destination: '777',
            channel: 'PJSIP/1005-00000005',
            callState: 'initiated'
        });

        await CallRepository.logCallEvent(callId, 'newchannel', {
            event: 'Newchannel'
        });

        // Answered
        await CallRepository.updateCallAnswered(uniqueId);
        await CallRepository.logCallEvent(callId, 'answered', {
            event: 'Stasis answered'
        });

        // Create transcription
        const transcriptionId = await TranscriptionRepository.createTranscription(
            callId,
            `/var/spool/asterisk/recording/mock-${uniqueId}.wav`
        );

        // Process transcription
        logger.info('Processing mock transcription...');
        await AIProcessor.processRecording(transcriptionId, `/mock-recording-${uniqueId}.wav`);

        await this.delay(1000);

        // End call
        await CallRepository.updateCallEnded(uniqueId, '16', 'Normal Clearing');
        await CallRepository.logCallEvent(callId, 'hangup', {
            event: 'Hangup'
        });

        this.simulatedCalls.push({ uniqueId, callId, transcriptionId, type: 'ai-transcription' });
        logger.info(`✅ AI transcription call simulated (ID: ${callId})`);
    }

    /**
     * Simulate multiple concurrent calls
     */
    async simulateMultipleCalls() {
        logger.info('\n📞📞📞 Simulating multiple concurrent calls...');

        const promises = [];
        
        for (let i = 0; i < 5; i++) {
            promises.push(this.createQuickCall(
                `200${i}`,
                `Test Caller ${i}`,
                `300${i}`
            ));
        }

        const results = await Promise.all(promises);
        results.forEach((r, i) => {
            this.simulatedCalls.push({ ...r, type: `bulk-${i}` });
        });

        logger.info(`✅ ${promises.length} concurrent calls simulated`);
    }

    /**
     * Create a quick call record
     */
    async createQuickCall(callerId, callerName, destination) {
        const uniqueId = uuidv4();

        const callId = await CallRepository.createCall({
            uniqueId,
            callerId,
            callerName,
            destination,
            channel: `PJSIP/${callerId}-${Date.now()}`,
            callState: 'initiated'
        });

        await CallRepository.updateCallAnswered(uniqueId);
        
        await this.delay(Math.random() * 1000 + 500);
        
        await CallRepository.updateCallEnded(uniqueId, '16', 'Normal Clearing');

        return { uniqueId, callId };
    }

    /**
     * Display simulation results
     */
    async displayResults() {
        logger.info('\n═══════════════════════════════════════════════════');
        logger.info('  Simulation Results');
        logger.info('═══════════════════════════════════════════════════');

        const { calls, total } = await CallRepository.getAllCalls(50, 0);
        
        logger.info(`\nTotal calls in database: ${total}`);
        logger.info('\nRecent calls:');
        
        calls.slice(0, 10).forEach((call, i) => {
            logger.info(`  ${i + 1}. ${call.caller_id} → ${call.destination}`);
            logger.info(`     State: ${call.call_state}, Duration: ${call.duration_seconds || 0}s`);
            logger.info(`     Transcription: ${call.transcription_status || 'none'}`);
        });

        const stats = await TranscriptionRepository.getStatistics();
        logger.info('\nTranscription Statistics:');
        logger.info(`  Total: ${stats.total}`);
        logger.info(`  Pending: ${stats.pending}`);
        logger.info(`  Processing: ${stats.processing}`);
        logger.info(`  Completed: ${stats.completed}`);
        logger.info(`  Failed: ${stats.failed}`);

        logger.info('\n═══════════════════════════════════════════════════');
        logger.info('  Test the API:');
        logger.info('  curl http://localhost:3000/calls');
        logger.info('  curl http://localhost:3000/transcriptions/stats');
        logger.info('═══════════════════════════════════════════════════');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run simulation
const simulator = new CallSimulator();
simulator.run().then(() => {
    logger.info('\nSimulation complete!');
    process.exit(0);
}).catch((error) => {
    // Handle both Error objects and string throws
    if (typeof error === 'string') {
        logger.error('Simulation failed (string error):', error);
    } else {
        logger.error('Simulation failed:', { 
            message: error?.message || 'No message', 
            stack: error?.stack || 'No stack',
            errorValue: String(error)
        });
    }
    process.exit(1);
});
