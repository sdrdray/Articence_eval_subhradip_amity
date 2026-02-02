/**
 * Express API Server
 * 
 * Provides REST endpoints for:
 * - Health checks
 * - Call history retrieval
 * - Service status monitoring
 */

import express from 'express';
import { apiLogger } from '../utils/logger.js';
import { CallRepository } from '../database/call-repository.js';
import { TranscriptionRepository } from '../database/transcription-repository.js';

export function createAPIServer() {
    const app = express();

    // Middleware
    app.use(express.json());
    
    // Request logging
    app.use((req, res, next) => {
        apiLogger.debug(`${req.method} ${req.path}`, {
            query: req.query,
            body: req.body
        });
        next();
    });

    // CORS headers
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        next();
    });

    // ====================
    // Health Check
    // ====================
    app.get('/health', (req, res) => {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });

    // ====================
    // Service Status
    // ====================
    app.get('/status', async (req, res) => {
        // Import gateway status (will be set by index.js)
        const amiStatus = global.amiClient?.getStatus?.() || { connected: false };
        const ariStatus = global.ariClient?.getStatus?.() || { connected: false };
        const transcriptionStats = await TranscriptionRepository.getStatistics();

        res.json({
            status: 'running',
            timestamp: new Date().toISOString(),
            services: {
                ami: amiStatus,
                ari: ariStatus
            },
            transcriptions: transcriptionStats
        });
    });

    // ====================
    // Call History Endpoint (Phase 3 Requirement)
    // ====================
    app.get('/calls', async (req, res) => {
        try {
            const {
                limit = 50,
                offset = 0,
                callerId,
                destination,
                startDate,
                endDate,
                callState
            } = req.query;

            const result = await CallRepository.getAllCalls(
                parseInt(limit),
                parseInt(offset),
                { callerId, destination, startDate, endDate, callState }
            );

            // Format response
            const formattedCalls = result.calls.map(call => ({
                id: call.id,
                uniqueId: call.unique_id,
                caller: {
                    number: call.caller_id,
                    name: call.caller_name
                },
                destination: call.destination,
                timing: {
                    startTime: call.start_time,
                    answerTime: call.answer_time,
                    endTime: call.end_time,
                    durationSeconds: call.duration_seconds
                },
                state: call.call_state,
                hangup: {
                    cause: call.hangup_cause,
                    description: call.hangup_cause_txt
                },
                transcription: {
                    status: call.transcription_status || 'none',
                    text: call.transcription_text,
                    recordingPath: call.recording_path
                }
            }));

            res.json({
                success: true,
                data: formattedCalls,
                pagination: {
                    total: result.total,
                    limit: result.limit,
                    offset: result.offset,
                    hasMore: result.hasMore
                }
            });

        } catch (error) {
            apiLogger.error('Error fetching calls:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch call history',
                message: error.message
            });
        }
    });

    // ====================
    // Get Specific Call
    // ====================
    app.get('/calls/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const call = await CallRepository.getCallById(parseInt(id));

            if (!call) {
                return res.status(404).json({
                    success: false,
                    error: 'Call not found'
                });
            }

            // Get call events
            const events = await CallRepository.getCallEvents(call.id);

            res.json({
                success: true,
                data: {
                    id: call.id,
                    uniqueId: call.unique_id,
                    caller: {
                        number: call.caller_id,
                        name: call.caller_name
                    },
                    destination: call.destination,
                    channels: {
                        source: call.channel,
                        destination: call.dest_channel
                    },
                    timing: {
                        startTime: call.start_time,
                        answerTime: call.answer_time,
                        endTime: call.end_time,
                        durationSeconds: call.duration_seconds
                    },
                    state: call.call_state,
                    hangup: {
                        cause: call.hangup_cause,
                        description: call.hangup_cause_txt
                    },
                    transcription: {
                        status: call.transcription_status || 'none',
                        text: call.transcription_text,
                        recordingPath: call.recording_path,
                        processingStartedAt: call.processing_started_at,
                        processingCompletedAt: call.processing_completed_at,
                        error: call.transcription_error
                    },
                    events: events.map(e => ({
                        type: e.event_type,
                        timestamp: e.timestamp,
                        data: JSON.parse(e.event_data || '{}')
                    })),
                    createdAt: call.created_at,
                    updatedAt: call.updated_at
                }
            });

        } catch (error) {
            apiLogger.error('Error fetching call:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch call',
                message: error.message
            });
        }
    });

    // ====================
    // Transcription Statistics
    // ====================
    app.get('/transcriptions/stats', async (req, res) => {
        try {
            const stats = await TranscriptionRepository.getStatistics();
            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            apiLogger.error('Error fetching transcription stats:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch transcription statistics'
            });
        }
    });

    // ====================
    // Get Specific Transcription
    // ====================
    app.get('/transcriptions/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const transcription = await TranscriptionRepository.getTranscriptionById(parseInt(id));

            if (!transcription) {
                return res.status(404).json({
                    success: false,
                    error: 'Transcription not found'
                });
            }

            res.json({
                success: true,
                data: transcription
            });

        } catch (error) {
            apiLogger.error('Error fetching transcription:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch transcription'
            });
        }
    });

    // ====================
    // Error Handler
    // ====================
    app.use((err, req, res, next) => {
        apiLogger.error('Unhandled error:', err);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    });

    // ====================
    // 404 Handler
    // ====================
    app.use((req, res) => {
        res.status(404).json({
            success: false,
            error: 'Not found',
            path: req.path
        });
    });

    return app;
}

export default createAPIServer;
