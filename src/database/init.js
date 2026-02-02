/**
 * Database Initialization
 * Sets up SQLite database for call records and AI transcriptions
 * Using sql.js (pure JavaScript SQLite implementation)
 */

import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { dbLogger } from '../utils/logger.js';

const DB_PATH = process.env.DATABASE_PATH || './data/calls.db';

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;
let SQL = null;

/**
 * Initialize SQL.js
 */
async function initSql() {
    if (!SQL) {
        SQL = await initSqlJs();
    }
    return SQL;
}

/**
 * Get database instance (singleton)
 */
export async function getDatabase() {
    if (!db) {
        await initSql();
        
        // Try to load existing database
        if (fs.existsSync(DB_PATH)) {
            const fileBuffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(fileBuffer);
            dbLogger.info('Loaded existing database');
        } else {
            db = new SQL.Database();
            dbLogger.info('Created new database');
        }
    }
    return db;
}

/**
 * Save database to file
 */
export function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
        dbLogger.debug('Database saved to disk');
    }
}

/**
 * Initialize database schema
 */
export async function initDatabase() {
    const database = await getDatabase();

    dbLogger.info('Creating database schema...');

    // Call records table
    database.run(`
        CREATE TABLE IF NOT EXISTS calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            unique_id TEXT UNIQUE NOT NULL,
            caller_id TEXT,
            caller_name TEXT,
            destination TEXT,
            channel TEXT,
            dest_channel TEXT,
            start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            answer_time DATETIME,
            end_time DATETIME,
            duration_seconds INTEGER,
            hangup_cause TEXT,
            hangup_cause_txt TEXT,
            call_state TEXT DEFAULT 'initiated',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // AI Transcriptions table
    database.run(`
        CREATE TABLE IF NOT EXISTS transcriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            call_id INTEGER NOT NULL,
            recording_path TEXT,
            transcription_text TEXT,
            transcription_status TEXT DEFAULT 'pending',
            processing_started_at DATETIME,
            processing_completed_at DATETIME,
            error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
        )
    `);

    // Call events table for detailed event logging
    database.run(`
        CREATE TABLE IF NOT EXISTS call_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            call_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            event_data TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
        )
    `);

    // Create indexes for better query performance
    database.run(`CREATE INDEX IF NOT EXISTS idx_calls_unique_id ON calls(unique_id)`);
    database.run(`CREATE INDEX IF NOT EXISTS idx_calls_start_time ON calls(start_time)`);
    database.run(`CREATE INDEX IF NOT EXISTS idx_calls_caller_id ON calls(caller_id)`);
    database.run(`CREATE INDEX IF NOT EXISTS idx_transcriptions_call_id ON transcriptions(call_id)`);
    database.run(`CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(transcription_status)`);
    database.run(`CREATE INDEX IF NOT EXISTS idx_call_events_call_id ON call_events(call_id)`);

    // Save to file
    saveDatabase();

    dbLogger.info('Database schema initialized successfully');
    return database;
}

/**
 * Close database connection
 */
export function closeDatabase() {
    if (db) {
        saveDatabase();
        db.close();
        db = null;
        dbLogger.info('Database connection closed');
    }
}

// Auto-save every 30 seconds
setInterval(() => {
    if (db) {
        saveDatabase();
    }
}, 30000);

// Save on exit
process.on('exit', () => {
    if (db) {
        saveDatabase();
    }
});

export default { getDatabase, initDatabase, closeDatabase, saveDatabase };
