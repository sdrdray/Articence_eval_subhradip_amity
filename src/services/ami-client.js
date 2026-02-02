/**
 * AMI (Asterisk Manager Interface) Client
 * 
 * Handles real-time event tracking from Asterisk:
 * - Newstate events (call state changes)
 * - Dial events (outgoing calls)
 * - Hangup events (call termination)
 * 
 * Features automatic reconnection on disconnect.
 */

import AsteriskManager from 'asterisk-manager';
import { EventEmitter } from 'events';
import { amiLogger } from '../utils/logger.js';
import { CallRepository } from '../database/call-repository.js';

export class AMIClient extends EventEmitter {
    constructor() {
        super();
        
        this.config = {
            host: process.env.AMI_HOST || '127.0.0.1',
            port: parseInt(process.env.AMI_PORT) || 5038,
            username: process.env.AMI_USERNAME || 'ai-gateway',
            password: process.env.AMI_PASSWORD || 'changeme'
        };

        this.reconnectInterval = parseInt(process.env.RECONNECT_INTERVAL_MS) || 5000;
        this.maxReconnectAttempts = parseInt(process.env.MAX_RECONNECT_ATTEMPTS) || 0;
        
        this.ami = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.shouldReconnect = true;
        
        // Track active calls
        this.activeCalls = new Map();
    }

    /**
     * Connect to AMI
     */
    async connect() {
        return new Promise((resolve, reject) => {
            amiLogger.info('Connecting to AMI...', { 
                host: this.config.host, 
                port: this.config.port 
            });

            try {
                this.ami = new AsteriskManager(
                    this.config.port,
                    this.config.host,
                    this.config.username,
                    this.config.password,
                    true // Events enabled
                );

                // Don't use keepConnected() - we handle reconnection ourselves
                // this.ami.keepConnected();

                // Connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (!this.isConnected) {
                        amiLogger.warn('AMI connection timeout, will retry...');
                        this.scheduleReconnect();
                        resolve(); // Don't reject, just schedule reconnect
                    }
                }, 10000);

                // Connection events
                this.ami.on('connect', () => {
                    clearTimeout(connectionTimeout);
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    amiLogger.info('✅ AMI Connected successfully');
                    this.emit('connected');
                    resolve();
                });

                this.ami.on('error', (error) => {
                    // Only log once, don't spam
                    if (this.reconnectAttempts === 0) {
                        amiLogger.error('AMI Error:', error);
                    }
                    this.emit('error', error);
                });

                this.ami.on('close', () => {
                    if (this.isConnected) {
                        this.isConnected = false;
                        amiLogger.warn('AMI Connection closed');
                        this.emit('disconnected');
                        this.scheduleReconnect();
                    }
                });

                // Register event handlers
                this.registerEventHandlers();

            } catch (error) {
                amiLogger.error('Failed to create AMI connection:', error);
                this.scheduleReconnect();
                resolve(); // Don't fail startup, schedule reconnect
            }
        });
    }

    /**
     * Register AMI event handlers
     */
    registerEventHandlers() {
        // Newchannel - A new channel is created
        this.ami.on('newchannel', (event) => {
            this.handleNewChannel(event);
        });

        // Newstate - Channel state change (ringing, answered, etc.)
        this.ami.on('newstate', (event) => {
            this.handleNewState(event);
        });

        // Dial - Outgoing call attempt
        this.ami.on('dial', (event) => {
            this.handleDial(event);
        });

        // Bridge - Channels connected
        this.ami.on('bridge', (event) => {
            this.handleBridge(event);
        });

        // Hangup - Call ended
        this.ami.on('hangup', (event) => {
            this.handleHangup(event);
        });

        // DTMF - Key press (for potential IVR integration)
        this.ami.on('dtmf', (event) => {
            this.handleDTMF(event);
        });

        // All events (for debugging)
        if (process.env.NODE_ENV === 'development') {
            this.ami.on('managerevent', (event) => {
                if (!['VarSet', 'RTCPSent', 'RTCPReceived'].includes(event.event)) {
                    amiLogger.debug('AMI Event:', { 
                        event: event.event, 
                        uniqueid: event.uniqueid 
                    });
                }
            });
        }
    }

    /**
     * Handle new channel creation
     */
    async handleNewChannel(event) {
        const uniqueId = event.uniqueid;
        if (!uniqueId) return;

        amiLogger.debug('New channel created', {
            uniqueId,
            channel: event.channel,
            callerIdNum: event.calleridnum,
            callerIdName: event.calleridname,
            exten: event.exten
        });

        // Create initial call record
        const callData = {
            uniqueId,
            callerId: event.calleridnum,
            callerName: event.calleridname,
            destination: event.exten,
            channel: event.channel,
            callState: 'initiated'
        };

        try {
            const callId = await CallRepository.createCall(callData);
            this.activeCalls.set(uniqueId, { id: callId, ...callData });
            
            await CallRepository.logCallEvent(callId, 'newchannel', event);
        } catch (error) {
            amiLogger.error('Error creating call record:', error);
        }

        this.emit('newchannel', event);
    }

    /**
     * Handle channel state change
     * State values:
     * - 0: Down
     * - 4: Ring (ringing)
     * - 5: Ringing (remote ringing)
     * - 6: Up (answered)
     */
    async handleNewState(event) {
        const uniqueId = event.uniqueid;
        const channelState = parseInt(event.channelstate);

        amiLogger.debug('Channel state change', {
            uniqueId,
            channel: event.channel,
            state: channelState,
            stateDesc: event.channelstatedesc
        });

        // State 6 = Up (Call Answered)
        if (channelState === 6) {
            amiLogger.info('📞 Call ANSWERED', {
                uniqueId,
                channel: event.channel,
                callerIdNum: event.calleridnum
            });

            try {
                await CallRepository.updateCallAnswered(uniqueId);
                
                const call = this.activeCalls.get(uniqueId);
                if (call) {
                    await CallRepository.logCallEvent(call.id, 'answered', event);
                }
            } catch (error) {
                amiLogger.error('Error updating call answered:', error);
            }

            this.emit('callanswered', {
                uniqueId,
                callerId: event.calleridnum,
                channel: event.channel,
                timestamp: new Date()
            });
        }

        this.emit('newstate', event);
    }

    /**
     * Handle dial event (outgoing call)
     */
    async handleDial(event) {
        const uniqueId = event.uniqueid;
        const destUniqueId = event.destuniqueid;

        amiLogger.debug('Dial event', {
            uniqueId,
            destUniqueId,
            subevent: event.subevent,
            destination: event.destination,
            dialstring: event.dialstring
        });

        // Update call with destination info
        if (event.subevent === 'Begin') {
            const call = this.activeCalls.get(uniqueId);
            if (call) {
                call.destChannel = event.destchannel;
                call.destination = event.destination || event.dialstring;
                
                await CallRepository.logCallEvent(call.id, 'dial', event);
            }
        }

        this.emit('dial', event);
    }

    /**
     * Handle bridge event (channels connected)
     */
    handleBridge(event) {
        amiLogger.debug('Bridge event', {
            uniqueId1: event.uniqueid1,
            uniqueId2: event.uniqueid2,
            bridgeState: event.bridgestate
        });

        this.emit('bridge', event);
    }

    /**
     * Handle hangup event
     */
    async handleHangup(event) {
        const uniqueId = event.uniqueid;
        const cause = event.cause;
        const causeTxt = event['cause-txt'];

        amiLogger.info('📴 Call HANGUP', {
            uniqueId,
            channel: event.channel,
            cause,
            causeTxt,
            callerIdNum: event.calleridnum
        });

        try {
            // Update call record with hangup info
            await CallRepository.updateCallEnded(uniqueId, cause, causeTxt);

            const call = this.activeCalls.get(uniqueId);
            if (call) {
                await CallRepository.logCallEvent(call.id, 'hangup', event);
                this.activeCalls.delete(uniqueId);
            }
        } catch (error) {
            amiLogger.error('Error updating call hangup:', error);
        }

        this.emit('hangup', {
            uniqueId,
            callerId: event.calleridnum,
            channel: event.channel,
            cause,
            causeTxt,
            timestamp: new Date()
        });
    }

    /**
     * Handle DTMF event
     */
    handleDTMF(event) {
        amiLogger.debug('DTMF received', {
            uniqueId: event.uniqueid,
            digit: event.digit,
            direction: event.direction
        });

        this.emit('dtmf', event);
    }

    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        if (!this.shouldReconnect) return;

        if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
            amiLogger.error('Max reconnect attempts reached');
            return;
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectAttempts++;
        amiLogger.info(`Scheduling AMI reconnect attempt ${this.reconnectAttempts} in ${this.reconnectInterval}ms`);

        this.reconnectTimer = setTimeout(async () => {
            amiLogger.info('Attempting AMI reconnection...');
            await this.connect();
        }, this.reconnectInterval);
    }

    /**
     * Execute an AMI action
     */
    async action(action) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('AMI not connected'));
                return;
            }

            this.ami.action(action, (error, response) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(response);
                }
            });
        });
    }

    /**
     * Originate a call (useful for testing)
     */
    async originateCall(channel, context, exten, priority = 1, callerID) {
        return this.action({
            action: 'Originate',
            channel,
            context,
            exten,
            priority,
            callerid: callerID,
            async: true
        });
    }

    /**
     * Disconnect from AMI
     */
    async disconnect() {
        this.shouldReconnect = false;
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        if (this.ami) {
            this.ami.disconnect();
            this.ami = null;
        }

        this.isConnected = false;
        amiLogger.info('AMI disconnected');
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.isConnected,
            host: this.config.host,
            port: this.config.port,
            reconnectAttempts: this.reconnectAttempts,
            activeCalls: this.activeCalls.size
        };
    }
}

export default AMIClient;
