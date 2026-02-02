# AI-PBX Gateway Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TELEPHONY LAYER                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │  Extension  │    │  Extension  │    │   Trunk     │                      │
│  │    101      │    │    102      │    │  (PSTN/SIP) │                      │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                      │
│         │                  │                  │                              │
│         └──────────────────┼──────────────────┘                              │
│                            ▼                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     ASTERISK / FREEPBX                               │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │    │
│  │  │   Dialplan  │  │     AMI     │  │     ARI     │                  │    │
│  │  │  (routing)  │  │  (events)   │  │  (control)  │                  │    │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │    │
│  └─────────┼────────────────┼────────────────┼──────────────────────────┘    │
└────────────┼────────────────┼────────────────┼──────────────────────────────┘
             │                │                │
             │         Port 5038         Port 8088
             │                │                │
┌────────────┼────────────────┼────────────────┼──────────────────────────────┐
│            │     MIDDLEWARE LAYER (Node.js)  │                              │
│            │                │                │                              │
│            │    ┌───────────▼───────────┐    │                              │
│            │    │      AMI Client       │    │                              │
│            │    │  - Event Tracking     │    │                              │
│            │    │  - Call Monitoring    │    │                              │
│            │    │  - Auto-reconnect     │    │                              │
│            │    └───────────┬───────────┘    │                              │
│            │                │                │                              │
│            │    ┌───────────▼───────────┐    │                              │
│            │    │      ARI Client       │◄───┘                              │
│            │    │  - Stasis App Handler │                                   │
│            │    │  - Playback Control   │                                   │
│            │    │  - Recording          │                                   │
│            │    │  - Auto-reconnect     │                                   │
│            │    └───────────┬───────────┘                                   │
│            │                │                                               │
│            │    ┌───────────▼───────────┐                                   │
│            │    │    AI Processor       │                                   │
│            │    │  - Async Processing   │                                   │
│            │    │  - Mock Transcription │                                   │
│            │    └───────────┬───────────┘                                   │
│            │                │                                               │
│  ┌─────────▼────────────────▼───────────────────────────────────────────┐   │
│  │                        SQLite Database                                │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │    calls     │  │transcriptions│  │ call_events  │                │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                       Express API Server                              │   │
│  │        GET /calls    GET /status    GET /health                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                              Port 3000
                                     │
                                     ▼
                            ┌────────────────┐
                            │  External Apps │
                            │  - Dashboard   │
                            │  - Analytics   │
                            │  - CRM         │
                            └────────────────┘
```

## Component Details

### 1. AMI Client (`ami-client.js`)

The AMI Client maintains a persistent TCP connection to Asterisk's Manager Interface for real-time event tracking.

#### Event Flow

```
Asterisk Event → AMI Client → Database → REST API
```

#### Tracked Events

| Event | Description | Action |
|-------|-------------|--------|
| `Newchannel` | New call initiated | Create call record |
| `Newstate` | Channel state change | Track answered state |
| `Dial` | Outgoing call attempt | Update destination |
| `Hangup` | Call terminated | Calculate duration |
| `DTMF` | Key press | Log for IVR |

#### Reconnection Logic

```javascript
// Automatic reconnection with exponential backoff
scheduleReconnect() {
    setTimeout(async () => {
        await this.connect();
    }, this.reconnectInterval);
}
```

### 2. ARI Client (`ari-client.js`)

The ARI Client provides call control capabilities through Asterisk's REST Interface using WebSocket for real-time events.

#### Voice-to-AI Pipeline

```
1. Call arrives at Stasis app (dial 777)
                    │
                    ▼
2. ARI Client answers call
                    │
                    ▼
3. Play greeting prompt ("demo-congrats")
                    │
                    ▼
4. Start recording (10 seconds)
                    │
                    ▼
5. Recording finished
                    │
                    ▼
6. Trigger async AI processing
                    │
                    ▼
7. Play goodbye, hangup
```

#### Channel State Management

```javascript
activeChannels: Map<channelId, {
    channel: ARIChannel,
    callerId: string,
    callerName: string,
    startTime: Date,
    state: 'started' | 'answered' | 'recording' | 'processing',
    recordingName?: string
}>
```

### 3. AI Processor (`ai-processor.js`)

Handles asynchronous transcription processing with mock delay simulation.

#### Processing Flow

```javascript
async processRecording(transcriptionId, recordingPath) {
    // 1. Mark as processing
    TranscriptionRepository.markAsProcessing(transcriptionId);
    
    // 2. Simulate AI delay (3 seconds)
    await this.simulateProcessingDelay();
    
    // 3. Generate mock transcription
    const text = this.generateMockTranscription();
    
    // 4. Save result
    TranscriptionRepository.completeTranscription(transcriptionId, text);
}
```

### 4. Database Schema

#### Calls Table

```sql
CREATE TABLE calls (
    id INTEGER PRIMARY KEY,
    unique_id TEXT UNIQUE NOT NULL,
    caller_id TEXT,
    caller_name TEXT,
    destination TEXT,
    channel TEXT,
    dest_channel TEXT,
    start_time DATETIME,
    answer_time DATETIME,
    end_time DATETIME,
    duration_seconds INTEGER,
    hangup_cause TEXT,
    call_state TEXT DEFAULT 'initiated'
);
```

#### Transcriptions Table

```sql
CREATE TABLE transcriptions (
    id INTEGER PRIMARY KEY,
    call_id INTEGER NOT NULL,
    recording_path TEXT,
    transcription_text TEXT,
    transcription_status TEXT DEFAULT 'pending',
    processing_started_at DATETIME,
    processing_completed_at DATETIME,
    FOREIGN KEY (call_id) REFERENCES calls(id)
);
```

### 5. API Endpoints

#### GET /calls

Returns paginated call history with transcription status.

**Query Parameters:**
- `limit` (default: 50)
- `offset` (default: 0)
- `callerId` - Filter by caller
- `destination` - Filter by destination
- `callState` - Filter by state
- `startDate`, `endDate` - Date range filter

#### GET /status

Returns service health and connection status.

**Response:**
```json
{
    "status": "running",
    "services": {
        "ami": { "connected": true },
        "ari": { "connected": true }
    },
    "transcriptions": {
        "total": 100,
        "pending": 5,
        "completed": 90,
        "failed": 5
    }
}
```

## Data Flow Diagrams

### Normal Call Flow (Extensions 101 → 102)

```
101 dials 102
     │
     ▼
[Newchannel Event] ─────────────────────────────────────┐
     │                                                   │
     ▼                                                   ▼
[Dial Event] ──────────────────────────────────────► AMI Client
     │                                                   │
     ▼                                                   ▼
102 answers                                       Create Call Record
     │                                                   │
     ▼                                                   ▼
[Newstate Event, state=6] ──────────────────────► Update: answered
     │
     ▼
Call in progress
     │
     ▼
[Hangup Event] ─────────────────────────────────► Update: duration
```

### AI Bridge Flow (Dial 777)

```
Caller dials 777
     │
     ▼
Dialplan routes to Stasis(ai-bridge)
     │
     ▼
[StasisStart Event] ─────────────────────────────► ARI Client
     │                                                  │
     ▼                                                  ▼
                                                  Answer call
                                                       │
                                                       ▼
                                                  Play prompt
                                                       │
                                                       ▼
                                                  Start recording
                                                       │
                                                       ▼
[RecordingFinished Event] ────────────────────► Create transcription
     │                                                  │
     ▼                                                  ▼
                                              Async AI processing
                                                       │
                                                       ▼
                                              Update transcription
                                                       │
                                                       ▼
                                              Play goodbye, hangup
```

## Reliability Features

### 1. Automatic Reconnection

Both AMI and ARI clients implement automatic reconnection:

```javascript
class AMIClient {
    shouldReconnect = true;
    reconnectInterval = 5000; // 5 seconds
    
    scheduleReconnect() {
        if (!this.shouldReconnect) return;
        
        setTimeout(async () => {
            await this.connect();
        }, this.reconnectInterval);
    }
}
```

### 2. Non-blocking Event Processing

All event handlers use async/await without blocking:

```javascript
// AI processing runs in background
setImmediate(async () => {
    await AIProcessor.processRecording(id, path);
});
```

### 3. Graceful Shutdown

```javascript
process.on('SIGTERM', async () => {
    await amiClient.disconnect();
    await ariClient.disconnect();
    process.exit(0);
});
```

## Production Considerations

### Scaling

- Use Redis for session storage across multiple instances
- Implement load balancing for API endpoints
- Consider separate worker processes for AI processing

### Monitoring

- Export metrics to Prometheus
- Set up alerting for connection failures
- Monitor transcription queue depth

### Security

- Enable TLS for ARI connections
- Use environment variables for secrets
- Implement API authentication
- Rate limit API endpoints

## Integration Points

### Real AI Services

Replace `ai-processor.js` mock with:

- **OpenAI Whisper**: `openai.audio.transcriptions.create()`
- **Google Speech-to-Text**: `@google-cloud/speech`
- **Azure Cognitive Services**: `@azure/cognitiveservices-speech-sdk`
- **AWS Transcribe**: `@aws-sdk/client-transcribe`

### Example: OpenAI Whisper Integration

```javascript
import OpenAI from 'openai';

const openai = new OpenAI();

async function transcribeWithWhisper(audioPath) {
    const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
    });
    return transcription.text;
}
```
