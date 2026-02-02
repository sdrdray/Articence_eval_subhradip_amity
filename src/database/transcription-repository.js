/**
 * Transcription Repository
 * Database operations for AI transcription records
 */

import { getDatabase, saveDatabase } from './init.js';
import { dbLogger } from '../utils/logger.js';

export class TranscriptionRepository {
    /**
     * Create a new transcription record
     */
    static async createTranscription(callId, recordingPath) {
        const db = await getDatabase();
        
        db.run(`
            INSERT INTO transcriptions (call_id, recording_path, transcription_status)
            VALUES (?, ?, 'pending')
        `, [callId, recordingPath]);

        const result = db.exec('SELECT last_insert_rowid() as id');
        const id = result[0]?.values[0]?.[0];
        
        saveDatabase();
        dbLogger.debug('Created transcription record', { id, callId });
        return id;
    }

    /**
     * Update transcription status to processing
     */
    static async markAsProcessing(transcriptionId) {
        const db = await getDatabase();
        
        db.run(`
            UPDATE transcriptions 
            SET transcription_status = 'processing',
                processing_started_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
        `, [transcriptionId]);

        const changes = db.getRowsModified();
        saveDatabase();
        return changes > 0;
    }

    /**
     * Update transcription with result
     */
    static async completeTranscription(transcriptionId, transcriptionText) {
        const db = await getDatabase();
        
        db.run(`
            UPDATE transcriptions 
            SET transcription_text = ?,
                transcription_status = 'completed',
                processing_completed_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
        `, [transcriptionText, transcriptionId]);

        const changes = db.getRowsModified();
        saveDatabase();
        dbLogger.info('Transcription completed', { transcriptionId });
        return changes > 0;
    }

    /**
     * Mark transcription as failed
     */
    static async failTranscription(transcriptionId, errorMessage) {
        const db = await getDatabase();
        
        db.run(`
            UPDATE transcriptions 
            SET transcription_status = 'failed',
                error_message = ?,
                processing_completed_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
        `, [errorMessage, transcriptionId]);

        const changes = db.getRowsModified();
        saveDatabase();
        dbLogger.error('Transcription failed', { transcriptionId, errorMessage });
        return changes > 0;
    }

    /**
     * Get transcription by ID
     */
    static async getTranscriptionById(id) {
        const db = await getDatabase();
        const result = db.exec('SELECT * FROM transcriptions WHERE id = ?', [id]);
        
        if (result.length === 0 || result[0].values.length === 0) {
            return null;
        }
        
        return this._rowToObject(result[0].columns, result[0].values[0]);
    }

    /**
     * Get transcription by call ID
     */
    static async getTranscriptionByCallId(callId) {
        const db = await getDatabase();
        const result = db.exec('SELECT * FROM transcriptions WHERE call_id = ?', [callId]);
        
        if (result.length === 0 || result[0].values.length === 0) {
            return null;
        }
        
        return this._rowToObject(result[0].columns, result[0].values[0]);
    }

    /**
     * Get all pending transcriptions
     */
    static async getPendingTranscriptions() {
        const db = await getDatabase();
        const result = db.exec(`
            SELECT * FROM transcriptions 
            WHERE transcription_status = 'pending'
            ORDER BY created_at ASC
        `);
        
        if (result.length === 0) {
            return [];
        }
        
        return result[0].values.map(row => this._rowToObject(result[0].columns, row));
    }

    /**
     * Get transcription statistics
     */
    static async getStatistics() {
        const db = await getDatabase();
        const result = db.exec(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN transcription_status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN transcription_status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN transcription_status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN transcription_status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM transcriptions
        `);
        
        if (result.length === 0 || result[0].values.length === 0) {
            return { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 };
        }
        
        return this._rowToObject(result[0].columns, result[0].values[0]);
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

export default TranscriptionRepository;
