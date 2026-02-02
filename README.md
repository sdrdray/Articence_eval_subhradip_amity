# AI-PBX Integration Gateway

A Node.js middleware service that connects FreePBX/Asterisk telephony systems with AI processing capabilities. The service monitors call events in real-time through AMI (Asterisk Manager Interface) and provides a voice-to-AI pipeline through ARI (Asterisk REST Interface).

## Project Overview

This middleware implements three core components:

1. **Real-Time Call Event Tracking**: Connects to Asterisk AMI to monitor Newstate, Dial, and Hangup events. Captures caller information, call duration, and stores data in SQLite database.

2. **Voice-to-AI Pipeline**: Implements a Stasis application (ai-bridge) through ARI that answers calls, plays prompts, records audio, and simulates AI transcription processing.

3. **Production Reliability**: Includes automatic reconnection logic with exponential backoff and configurable retry limits. Handles connection failures gracefully without crashing.

## Technical Requirements

- Node.js 18 or higher (ES Modules required)
- FreePBX 17 running on Debian 12
- Asterisk 22 with AMI and ARI enabled
- Network access to Asterisk ports (5038 for AMI, 8088 for ARI)

## Installation

### 1. Install Node.js Dependencies

```bash
npm install
```

This will install:
- express (API server)
- asterisk-manager (AMI client)
- ari-client (ARI/Stasis interface)
- sql.js (SQLite database)
- dotenv (environment configuration)
- winston (logging)

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit the .env file with your Asterisk credentials:

```env
AMI_HOST=127.0.0.1
AMI_PORT=5038
AMI_USERNAME=ai-gateway
AMI_PASSWORD=your_ami_password

ARI_HOST=127.0.0.1
ARI_PORT=8088
ARI_USERNAME=ai-gateway
ARI_PASSWORD=your_ari_password
ARI_APP_NAME=ai-bridge
```

### 3. Initialize Database Schema

The database initializes automatically on first run. To manually initialize:

```bash
npm run db:init
```

### 4. Start the Gateway Service

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## API Reference

### Available Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health status |
| `/status` | GET | AMI and ARI connection status |
| `/calls` | GET | Retrieve call history with transcription data |
| `/calls/:id` | GET | Get details for a specific call |
| `/transcriptions/stats` | GET | Aggregated transcription statistics |

### Example Usage

Get all calls:
```bash
curl http://localhost:3000/calls
```

Example response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "uniqueId": "1234567890.1",
      "caller": {
        "number": "101",
        "name": "Extension 101"
      },
      "destination": "102",
      "timing": {
        "startTime": "2026-02-01T10:00:00.000Z",
        "answerTime": "2026-02-01T10:00:05.000Z",
        "endTime": "2026-02-01T10:02:30.000Z",
        "durationSeconds": 145
      },
      "state": "ended",
      "transcription": {
        "status": "completed",
        "text": "Mock transcription of recorded audio",
        "confidence": 0.95
      }
    }
  ],
  "total": 1
}
```

## Configuration Options

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP API server port |
| `AMI_HOST` | 127.0.0.1 | Asterisk Manager Interface host |
| `AMI_PORT` | 5038 | AMI port (standard Asterisk default) |
| `AMI_USERNAME` | ai-gateway | AMI user (must exist in manager.conf) |
| `AMI_PASSWORD` | - | AMI user password |
| `ARI_HOST` | 127.0.0.1 | Asterisk REST Interface host |
| `ARI_PORT` | 8088 | ARI port (configured in http.conf) |
| `ARI_USERNAME` | ai-gateway | ARI user (must exist in ari.conf) |
| `ARI_PASSWORD` | - | ARI user password |
| `ARI_APP_NAME` | ai-bridge | Stasis application name |

### Advanced Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `RECONNECT_INTERVAL_MS` | 5000 | Milliseconds between reconnection attempts |
| `MAX_RECONNECT_ATTEMPTS` | 3 | Maximum reconnection retries before giving up |
| `AI_PROCESSING_DELAY_MS` | 3000 | Simulated AI processing delay |
| `RECORDING_DURATION_SECONDS` | 10 | Maximum recording length for voice capture |

## Project Structure

The codebase is organized into logical modules:

```
ai-pbx-gateway/
├── src/
│   ├── index.js                      # Application entry point and orchestration
│   ├── api/
│   │   └── server.js                 # Express REST API server
│   ├── database/
│   │   ├── init.js                   # Database schema initialization
│   │   ├── call-repository.js        # Call data access layer
│   │   └── transcription-repository.js  # Transcription data access
│   ├── services/
│   │   ├── ami-client.js             # AMI connection and event handlers
│   │   ├── ari-client.js             # ARI Stasis application logic
│   │   └── ai-processor.js           # Mock AI transcription service
│   └── utils/
│       └── logger.js                 # Winston logging configuration
├── config/
│   └── asterisk/                     # Sample Asterisk configuration files
│       ├── extensions_custom.conf    # Dialplan for extension 777
│       ├── ari.conf                  # ARI user configuration
│       ├── http.conf                 # ARI HTTP server settings
│       └── manager.d/
│           └── ai-gateway.conf       # AMI user configuration
├── scripts/
│   ├── test-reconnection.js          # Tests automatic reconnection
│   ├── simulate-call.js              # Generates test call data
│   └── test-api.js                   # API endpoint validation
├── docs/
│   ├── INSTALLATION.md               # FreePBX setup instructions
│   ├── ARCHITECTURE.md               # System design documentation
│   └── INSTALLATION_LOG.md           # Installation hurdles and solutions
├── data/                             # SQLite database storage
├── recordings/                       # Call recordings directory
├── logs/                             # Winston log files
├── .env.example                      # Environment variable template
└── package.json                      # Node.js dependencies and scripts
```

## Testing

### Reconnection Resilience Test

Verifies that the service handles Asterisk restarts gracefully:

```bash
npm run test:reconnect
```

This monitors AMI/ARI connections while Asterisk is running. Restart Asterisk to observe automatic reconnection behavior.

### Call Simulation

Generates test data in the database:

```bash
npm run test:call
```

This creates sample call records with mock transcription data for API testing.

### API Validation

Test all API endpoints:

```bash
npm run test:api
```

## Documentation

- [Installation Guide](docs/INSTALLATION.md) - Complete FreePBX setup process
- [Architecture Overview](docs/ARCHITECTURE.md) - System design and component interaction
- [Installation Log](INSTALLATION_LOG.md) - Challenges encountered and solutions

## Implementation Notes

### Database Choice

This project uses sql.js instead of better-sqlite3 to avoid native compilation requirements. While sql.js has slightly lower performance for write operations, it provides cross-platform compatibility without requiring Visual Studio Build Tools or node-gyp on Windows systems.

### AMI Connection Management

The asterisk-manager library's keepConnected feature was disabled in favor of custom reconnection logic. This provides better control over retry behavior and prevents resource exhaustion from infinite reconnection loops.

### Error Handling Strategy

The application implements graceful degradation. If AMI or ARI connections fail, the service continues running and serves cached data through the API. Connection failures are logged but do not crash the process.

## Production Deployment Considerations

1. Replace sql.js with PostgreSQL or MySQL for production workloads
2. Implement proper authentication for API endpoints
3. Configure reverse proxy (nginx) for HTTPS support
4. Set up log rotation for winston logs
5. Use process manager (pm2) for automatic restart on crashes
6. Configure firewall rules to restrict AMI/ARI access
7. Implement rate limiting on API endpoints
8. Add monitoring and alerting for connection failures

## License

This project was developed as part of a technical evaluation task. For educational and demonstration purposes.

## 🔒 Security Notes

- Change default passwords in `.env`
- Use TLS for production ARI connections
- Restrict AMI access by IP in `manager.d/ai-gateway.conf`
- Consider firewall rules for ports 5038 and 8088

## 📄 License

MIT
