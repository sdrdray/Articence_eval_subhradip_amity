/**
 * Winston Logger Configuration
 * Provides structured logging for the AI-PBX Gateway
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `[${timestamp}] ${level}: ${message} ${metaStr}`;
    })
);

// JSON format for file output
const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
);

export const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transports: [
        // Console transport
        new winston.transports.Console({
            format: consoleFormat
        }),
        // File transport for errors
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            format: fileFormat
        }),
        // File transport for all logs
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            format: fileFormat
        })
    ]
});

// Create specialized loggers for different components
export const amiLogger = logger.child({ service: 'AMI' });
export const ariLogger = logger.child({ service: 'ARI' });
export const apiLogger = logger.child({ service: 'API' });
export const dbLogger = logger.child({ service: 'Database' });
