/**
 * ARI (Asterisk REST Interface) Client
 * 
 * Handles the Voice-to-AI pipeline:
 * - Answer incoming calls to Stasis application
 * - Play system prompts
 * - Record caller audio
 * - Trigger AI transcription processing
 * 
 * Features automatic reconnection on disconnect.
 */

import ARI from 'ari-client';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { ariLogger } from '../utils/logger.js';
import { CallRepository } from '../database/call-repository.js';
import { TranscriptionRepository } from '../database/transcription-repository.js';
import { AIProcessor } from './ai-processor.js';

export class ARIClient extends EventEmitter {
    constructor() {
        super();
        
        this.config = {
            host: process.env.ARI_HOST || '127.0.0.1',
            port: parseInt(process.env.ARI_PORT) || 8088,
            username: process.env.ARI_USERNAME || 'ai-bridge',
            password: process.env.ARI_PASSWORD || 'changeme',
            appName: process.env.ARI_APP_NAME || 'ai-bridge'
        };

        this.recordingDuration = parseInt(process.env.RECORDING_DURATION_SECONDS) || 10;
        this.reconnectInterval = parseInt(process.env.RECONNECT_INTERVAL_MS) || 5000;
        this.maxReconnectAttempts = parseInt(process.env.MAX_RECONNECT_ATTEMPTS) || 0;

        this.ari = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.shouldReconnect = true;

        // Track active channels
        this.activeChannels = new Map();

        // Ensure recordings directory exists
        this.recordingsDir = './recordings';
        if (!fs.existsSync(this.recordingsDir)) {
            fs.mkdirSync(this.recordingsDir, { recursive: true });
        }
    }

    /**
     * Connect to ARI
     */
    async connect() {
        const url = `http://${this.config.host}:${this.config.port}`;
        
        ariLogger.info('Connecting to ARI...', { 
            url,
            appName: this.config.appName
        });

        try {
            this.ari = await ARI.connect(
                url,
                this.config.username,
                this.config.password
            );

            this.isConnected = true;
            this.reconnectAttempts = 0;
            ariLogger.info('✅ ARI Connected successfully');

            // Register event handlers
            this.registerEventHandlers();

            // Start the Stasis application
            await this.startStasisApp();

            this.emit('connected');

        } catch (error) {
            ariLogger.error('Failed to connect to ARI:', error.message);
            this.isConnected = false;
            this.scheduleReconnect();
        }
    }

    /**
     * Start the Stasis application to receive calls
     */
    async startStasisApp() {
        ariLogger.info(`Starting Stasis application: ${this.config.appName}`);

        // Handle incoming calls to our Stasis app
        this.ari.on('StasisStart', async (event, channel) => {
            await this.handleStasisStart(event, channel);
        });

        // Handle channel ending
        this.ari.on('StasisEnd', (event, channel) => {
            this.handleStasisEnd(event, channel);
        });

        // Handle playback finished
        this.ari.on('PlaybackFinished', (event, playback) => {
            this.handlePlaybackFinished(event, playback);
        });

        // Handle recording finished
        this.ari.on('RecordingFinished', (event, recording) => {
            this.handleRecordingFinished(event, recording);
        });

        // Handle channel state change
        this.ari.on('ChannelStateChange', (event, channel) => {
            ariLogger.debug('Channel state changed', {
                channelId: channel.id,
                state: channel.state
            });
        });

        // Start the application
        try {
            await this.ari.start(this.config.appName);
            ariLogger.info(`Stasis application '${this.config.appName}' started`);
        } catch (error) {
            ariLogger.error('Failed to start Stasis application:', error);
        }
    }

    /**
     * Register additional event handlers
     */
    registerEventHandlers() {
        // WebSocket events for connection monitoring
        if (this.ari._ws) {
            this.ari._ws.on('close', () => {
                ariLogger.warn('ARI WebSocket closed');
                this.isConnected = false;
                this.emit('disconnected');
                this.scheduleReconnect();
            });

            this.ari._ws.on('error', (error) => {
                ariLogger.error('ARI WebSocket error:', error);
                this.emit('error', error);
            });
        }
    }

    /**
     * Handle incoming call to Stasis application
     * This is the main Voice-to-AI pipeline entry point
     */
    async handleStasisStart(event, channel) {
        const channelId = channel.id;
        const callerId = channel.caller.number;
        const callerName = channel.caller.name;

        ariLogger.info('🎙️ Stasis call received', {
            channelId,
            callerId,
            callerName,
            args: event.args
        });

        // Store channel reference
        this.activeChannels.set(channelId, {
            channel,
            callerId,
            callerName,
            startTime: new Date(),
            state: 'started'
        });

        try {
            // Step 1: Answer the call
            ariLogger.info('Answering call...', { channelId });
            await channel.answer();
            
            this.activeChannels.get(channelId).state = 'answered';
            ariLogger.info('Call answered', { channelId });

            // Step 2: Play system prompt
            ariLogger.info('Playing system prompt...', { channelId });
            await this.playPrompt(channel, 'demo-congrats');

            // Step 3: Start recording (will be triggered after playback)
            // Recording is handled in handlePlaybackFinished

        } catch (error) {
            ariLogger.error('Error handling Stasis call:', error);
            await this.hangupChannel(channel, 'error');
        }
    }

    /**
     * Play a sound prompt on the channel
     */
    async playPrompt(channel, sound) {
        const playbackId = uuidv4();
        
        ariLogger.debug('Starting playback', {
            channelId: channel.id,
            sound,
            playbackId
        });

        try {
            const playback = this.ari.Playback(playbackId);
            
            // Store playback reference in channel data
            const channelData = this.activeChannels.get(channel.id);
            if (channelData) {
                channelData.currentPlayback = playbackId;
                channelData.pendingRecording = true;
            }

            await channel.play({ media: `sound:${sound}` }, playback);
            
            ariLogger.info('Playback started', {
                channelId: channel.id,
                sound,
                playbackId
            });

        } catch (error) {
            ariLogger.error('Failed to play prompt:', error);
            throw error;
        }
    }

    /**
     * Handle playback finished - start recording
     */
    async handlePlaybackFinished(event, playback) {
        ariLogger.debug('Playback finished', {
            playbackId: playback.id,
            state: playback.state
        });

        // Find the channel associated with this playback
        for (const [channelId, data] of this.activeChannels) {
            if (data.currentPlayback === playback.id && data.pendingRecording) {
                data.pendingRecording = false;
                
                ariLogger.info('Starting recording after prompt...', { channelId });
                await this.startRecording(data.channel);
                break;
            }
        }
    }

    /**
     * Start recording the channel
     */
    async startRecording(channel) {
        const recordingName = `recording-${channel.id}-${Date.now()}`;
        
        ariLogger.info('Starting recording', {
            channelId: channel.id,
            recordingName,
            duration: this.recordingDuration
        });

        try {
            // Update channel data
            const channelData = this.activeChannels.get(channel.id);
            if (channelData) {
                channelData.recordingName = recordingName;
                channelData.state = 'recording';
            }

            // Play a beep before recording
            try {
                await channel.play({ media: 'sound:beep' });
            } catch (e) {
                // Beep is optional
            }

            // Start recording
            const recording = await channel.record({
                name: recordingName,
                format: 'wav',
                maxDurationSeconds: this.recordingDuration,
                maxSilenceSeconds: 3,
                beep: false,
                terminateOn: '#'
            });

            ariLogger.info('Recording started', {
                channelId: channel.id,
                recordingName
            });

            // Set timeout to stop recording
            setTimeout(async () => {
                try {
                    await this.stopRecording(recordingName);
                } catch (error) {
                    // Recording might have already stopped
                    ariLogger.debug('Recording already stopped or error:', error.message);
                }
            }, (this.recordingDuration + 1) * 1000);

        } catch (error) {
            ariLogger.error('Failed to start recording:', error);
            await this.hangupChannel(channel, 'recording_error');
        }
    }

    /**
     * Stop a recording
     */
    async stopRecording(recordingName) {
        try {
            const recording = this.ari.LiveRecording({ name: recordingName });
            await recording.stop();
            ariLogger.info('Recording stopped', { recordingName });
        } catch (error) {
            ariLogger.debug('Error stopping recording:', error.message);
        }
    }

    /**
     * Handle recording finished - trigger AI processing
     */
    async handleRecordingFinished(event, recording) {
        const recordingName = recording.name;
        
        ariLogger.info('Recording finished', {
            recordingName,
            duration: recording.duration,
            format: recording.format
        });

        // Find the channel associated with this recording
        for (const [channelId, data] of this.activeChannels) {
            if (data.recordingName === recordingName) {
                data.state = 'processing';
                
                // Construct recording path
                const recordingPath = `/var/spool/asterisk/recording/${recordingName}.wav`;
                
                ariLogger.info('Recording completed, triggering AI processing', {
                    channelId,
                    recordingPath,
                    duration: recording.duration
                });

                // Create call record if not exists
                let callId;
                try {
                    const existingCall = await CallRepository.getCallByUniqueId(channelId);
                    if (existingCall) {
                        callId = existingCall.id;
                    } else {
                        callId = await CallRepository.createCall({
                            uniqueId: channelId,
                            callerId: data.callerId,
                            callerName: data.callerName,
                            destination: '777',
                            channel: `ARI/${channelId}`,
                            callState: 'in_stasis'
                        });
                    }

                    // Create transcription record
                    const transcriptionId = await TranscriptionRepository.createTranscription(
                        callId,
                        recordingPath
                    );

                    // Trigger async AI processing
                    this.triggerAIProcessing(transcriptionId, recordingPath, channelId);

                } catch (error) {
                    ariLogger.error('Error saving recording info:', error);
                }

                // Play thank you message and hangup
                try {
                    await data.channel.play({ media: 'sound:vm-goodbye' });
                    
                    // Hangup after goodbye message
                    setTimeout(async () => {
                        await this.hangupChannel(data.channel, 'normal');
                    }, 2000);
                } catch (error) {
                    ariLogger.error('Error playing goodbye:', error);
                    await this.hangupChannel(data.channel, 'normal');
                }

                break;
            }
        }
    }

    /**
     * Trigger asynchronous AI processing (mock transcription)
     */
    async triggerAIProcessing(transcriptionId, recordingPath, channelId) {
        ariLogger.info('🤖 Triggering AI processing...', {
            transcriptionId,
            recordingPath
        });

        // Use setImmediate to run async without blocking
        setImmediate(async () => {
            try {
                await AIProcessor.processRecording(transcriptionId, recordingPath);
            } catch (error) {
                ariLogger.error('AI processing error:', error);
            }
        });
    }

    /**
     * Handle channel leaving Stasis
     */
    handleStasisEnd(event, channel) {
        const channelId = channel.id;

        ariLogger.info('Stasis end', {
            channelId,
            cause: event.cause,
            causeTxt: event.cause_txt
        });

        // Clean up channel data
        this.activeChannels.delete(channelId);

        this.emit('stasisend', { channelId, channel });
    }

    /**
     * Hangup a channel
     */
    async hangupChannel(channel, reason = 'normal') {
        try {
            ariLogger.info('Hanging up channel', {
                channelId: channel.id,
                reason
            });

            await channel.hangup({ reason });
        } catch (error) {
            ariLogger.debug('Error hanging up (channel may already be gone):', error.message);
        }
    }

    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        if (!this.shouldReconnect) return;

        if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
            ariLogger.error('Max reconnect attempts reached');
            return;
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectAttempts++;
        ariLogger.info(`Scheduling ARI reconnect attempt ${this.reconnectAttempts} in ${this.reconnectInterval}ms`);

        this.reconnectTimer = setTimeout(async () => {
            ariLogger.info('Attempting ARI reconnection...');
            await this.connect();
        }, this.reconnectInterval);
    }

    /**
     * Disconnect from ARI
     */
    async disconnect() {
        this.shouldReconnect = false;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        // Hangup all active channels
        for (const [channelId, data] of this.activeChannels) {
            try {
                await this.hangupChannel(data.channel, 'shutdown');
            } catch (error) {
                // Ignore errors during shutdown
            }
        }

        if (this.ari) {
            try {
                await this.ari.stop();
            } catch (error) {
                // Ignore
            }
            this.ari = null;
        }

        this.isConnected = false;
        ariLogger.info('ARI disconnected');
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.isConnected,
            host: this.config.host,
            port: this.config.port,
            appName: this.config.appName,
            reconnectAttempts: this.reconnectAttempts,
            activeChannels: this.activeChannels.size
        };
    }
}

export default ARIClient;
