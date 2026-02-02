/**
 * Call Repository
 * Database operations for call records
 */

import { getDatabase, saveDatabase } from './init.js';
import { dbLogger } from '../utils/logger.js';

export class CallRepository {
    /**
     * Create a new call record
     */
    static async createCall(callData) {
        const db = await getDatabase();
        
        try {
            db.run(`
                INSERT INTO calls (
                    unique_id, caller_id, caller_name, destination, 
                    channel, dest_channel, call_state
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                callData.uniqueId,
                callData.callerId,
                callData.callerName,
                callData.destination,
                callData.channel,
                callData.destChannel || null,
                callData.callState || 'initiated'
            ]);

            // Get the last inserted ID
            const result = db.exec('SELECT last_insert_rowid() as id');
            const id = result[0]?.values[0]?.[0];
            
            saveDatabase();
            dbLogger.debug('Created call record', { id, uniqueId: callData.uniqueId });
            return id;
        } catch (error) {
            const errMsg = typeof error === 'string' ? error : error?.message;
            if (errMsg?.includes('UNIQUE constraint failed')) {
                dbLogger.debug('Call record already exists', { uniqueId: callData.uniqueId });
                const existing = await this.getCallByUniqueId(callData.uniqueId);
                return existing?.id;
            }
            // Wrap string errors
            if (typeof error === 'string') {
                throw new Error(error || 'Unknown database error');
            }
            throw error;
        }
    }

    /**
     * Update call when answered
     */
    static async updateCallAnswered(uniqueId) {
        const db = await getDatabase();
        
        db.run(`
            UPDATE calls 
            SET answer_time = datetime('now'),
                call_state = 'answered',
                updated_at = datetime('now')
            WHERE unique_id = ?
        `, [uniqueId]);

        const changes = db.getRowsModified();
        saveDatabase();
        dbLogger.debug('Call answered', { uniqueId, changes });
        return changes > 0;
    }

    /**
     * Update call when ended (hangup)
     */
    static async updateCallEnded(uniqueId, hangupCause, hangupCauseTxt) {
        const db = await getDatabase();
        
        // First get the call to calculate duration
        const call = await this.getCallByUniqueId(uniqueId);
        if (!call) {
            dbLogger.warn('Call not found for hangup', { uniqueId });
            return false;
        }

        // Calculate duration
        let durationSeconds = 0;
        if (call.answer_time) {
            const answerTime = new Date(call.answer_time);
            const endTime = new Date();
            durationSeconds = Math.floor((endTime - answerTime) / 1000);
        }

        db.run(`
            UPDATE calls 
            SET end_time = datetime('now'),
                duration_seconds = ?,
                hangup_cause = ?,
                hangup_cause_txt = ?,
                call_state = 'ended',
                updated_at = datetime('now')
            WHERE unique_id = ?
        `, [durationSeconds, hangupCause, hangupCauseTxt, uniqueId]);

        const changes = db.getRowsModified();
        saveDatabase();
        dbLogger.info('Call ended', { 
            uniqueId, 
            durationSeconds, 
            hangupCause,
            changes 
        });
        return changes > 0;
    }

    /**
     * Update call state
     */
    static async updateCallState(uniqueId, state) {
        const db = await getDatabase();
        
        db.run(`
            UPDATE calls 
            SET call_state = ?,
                updated_at = datetime('now')
            WHERE unique_id = ?
        `, [state, uniqueId]);

        const changes = db.getRowsModified();
        saveDatabase();
        return changes > 0;
    }

    /**
     * Get call by unique ID
     */
    static async getCallByUniqueId(uniqueId) {
        const db = await getDatabase();
        const result = db.exec('SELECT * FROM calls WHERE unique_id = ?', [uniqueId]);
        
        if (result.length === 0 || result[0].values.length === 0) {
            return null;
        }
        
        return this._rowToObject(result[0].columns, result[0].values[0]);
    }

    /**
     * Get call by ID
     */
    static async getCallById(id) {
        const db = await getDatabase();
        const result = db.exec(`
            SELECT c.*, 
                   t.transcription_text,
                   t.transcription_status,
                   t.recording_path,
                   t.processing_started_at,
                   t.processing_completed_at,
                   t.error_message as transcription_error
            FROM calls c
            LEFT JOIN transcriptions t ON c.id = t.call_id
            WHERE c.id = ?
        `, [id]);
        
        if (result.length === 0 || result[0].values.length === 0) {
            return null;
        }
        
        return this._rowToObject(result[0].columns, result[0].values[0]);
    }

    /**
     * Get all calls with pagination
     */
    static async getAllCalls(limit = 50, offset = 0, filters = {}) {
        const db = await getDatabase();
        
        let whereClause = '1=1';
        const params = [];

        if (filters.callerId) {
            whereClause += ' AND c.caller_id LIKE ?';
            params.push(`%${filters.callerId}%`);
        }

        if (filters.destination) {
            whereClause += ' AND c.destination LIKE ?';
            params.push(`%${filters.destination}%`);
        }

        if (filters.startDate) {
            whereClause += ' AND c.start_time >= ?';
            params.push(filters.startDate);
        }

        if (filters.endDate) {
            whereClause += ' AND c.start_time <= ?';
            params.push(filters.endDate);
        }

        if (filters.callState) {
            whereClause += ' AND c.call_state = ?';
            params.push(filters.callState);
        }

        // Get total count
        const countResult = db.exec(`
            SELECT COUNT(*) as total FROM calls c WHERE ${whereClause}
        `, params);
        const total = countResult[0]?.values[0]?.[0] || 0;

        // Get paginated results
        const queryParams = [...params, limit, offset];
        const result = db.exec(`
            SELECT c.*, 
                   t.transcription_text,
                   t.transcription_status,
                   t.recording_path
            FROM calls c
            LEFT JOIN transcriptions t ON c.id = t.call_id
            WHERE ${whereClause}
            ORDER BY c.start_time DESC
            LIMIT ? OFFSET ?
        `, queryParams);

        const calls = result.length > 0 
            ? result[0].values.map(row => this._rowToObject(result[0].columns, row))
            : [];

        return {
            calls,
            total,
            limit,
            offset,
            hasMore: offset + calls.length < total
        };
    }

    /**
     * Log call event
     */
    static async logCallEvent(callId, eventType, eventData) {
        const db = await getDatabase();
        
        db.run(`
            INSERT INTO call_events (call_id, event_type, event_data)
            VALUES (?, ?, ?)
        `, [callId, eventType, JSON.stringify(eventData)]);
        
        saveDatabase();
    }

    /**
     * Get call events
     */
    static async getCallEvents(callId) {
        const db = await getDatabase();
        const result = db.exec(`
            SELECT * FROM call_events 
            WHERE call_id = ? 
            ORDER BY timestamp ASC
        `, [callId]);
        
        if (result.length === 0) {
            return [];
        }
        
        return result[0].values.map(row => this._rowToObject(result[0].columns, row));
    }

    /**
     * Convert row array to object
     */
    static _rowToObject(columns, values) {
        const obj = {};
        columns.forEach((col, i) => {
            obj[col] = values[i];
        });
        return obj;
    }
}

export default CallRepository;
