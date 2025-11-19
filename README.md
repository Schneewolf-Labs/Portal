# Portal

A WebSocket-based relay/multiplexing server that acts as a message broker between distributed portal servers and clients.

## Features

- **Load Balancing**: Automatically distributes clients across portal servers using least-populated strategy
- **Health Monitoring**: Built-in health check and status endpoints
- **Structured Logging**: Configurable log levels (DEBUG, INFO, WARN, ERROR)
- **Connection Management**: Automatic heartbeat pings and graceful disconnect handling
- **Message Validation**: Comprehensive input validation and error handling
- **High Performance**: O(1) client lookup using Map-based indexing
- **Production Ready**: Full test coverage with automated CI/CD

## Architecture

```
┌─────────────────────────────────┐
│    Portal Server (index.js)     │
│  - HTTP/WebSocket Server        │
│  - Connection Manager           │
│  - Message Router               │
└────────┬────────────────────────┘
         │
    ┌────┼────┐
    │    │    │
┌───▼──┐ │ ┌──▼───┐
│Portal│ │ │Client│
│Server│ │ │      │
│Node  │ │ │      │
└──────┘ │ └──────┘
         │
    ┌────▼────┐
    │ More    │
    │ Portals │
    │& Clients│
    └─────────┘
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create .env file

Create a `.env` file in the root directory:

```bash
# Required: Server listening port
PORTAL_LISTEN_PORT=3069

# Required: Key for portal servers to register
PORTAL_REGISTER_KEY=your-secure-register-key

# Required: Key for clients to join
PORTAL_JOIN_KEY=your-secure-join-key

# Optional: Log level (DEBUG, INFO, WARN, ERROR)
# Default: INFO
LOG_LEVEL=INFO
```

### 3. Start the server

```bash
node index.js
```

## API Documentation

### HTTP Endpoints

#### GET /health

Health check endpoint for monitoring and load balancers.

**Response:**
```json
{
  "status": "healthy",
  "uptime": 123.456,
  "timestamp": "2025-11-19T00:00:00.000Z"
}
```

#### GET /status

Detailed status with metrics about portals and clients.

**Response:**
```json
{
  "portals": 2,
  "clients": 5,
  "portalStats": [
    { "clientCount": 3 },
    { "clientCount": 2 }
  ],
  "uptime": 123.456,
  "timestamp": "2025-11-19T00:00:00.000Z"
}
```

### WebSocket Protocol

#### Portal Registration

Connect to the WebSocket server and send:

```json
{
  "event": "portal:register",
  "key": "your-register-key"
}
```

**Success Response:**
```json
{
  "event": "portal:registered",
  "success": true
}
```

#### Client Join

Connect to the WebSocket server and send:

```json
{
  "event": "portal:join",
  "key": "your-join-key"
}
```

**Success Response:**
```json
{
  "event": "portal:joined",
  "success": true,
  "clientID": "uuid-v4-client-id"
}
```

#### Message Routing

**Client to Portal:**
All messages from clients are automatically tagged with `_clientID` and routed to their assigned portal.

**Portal to Client:**
Portal servers send messages with `_clientID` to route to specific clients:

```json
{
  "_clientID": "uuid-v4-client-id",
  "your": "message",
  "data": "here"
}
```

The `_clientID` field is automatically stripped before delivery to the client.

#### Heartbeat

Portals receive automatic heartbeat pings every 30 seconds:

```json
{
  "event": "portal:heartbeat"
}
```

#### Client Disconnect Notification

When a client disconnects, the portal is notified:

```json
{
  "_clientID": "uuid-v4-client-id",
  "event": "portal:client:disconnect"
}
```

## Development

### Running Tests

```bash
npm test
```

The test suite includes:
- Health endpoint tests
- Portal registration tests (valid/invalid keys)
- Client join tests (valid/invalid keys)
- Message validation tests
- Error handling tests

### Continuous Integration

GitHub Actions automatically runs tests on:
- Push to `main`, `master`, or `develop` branches
- All pull requests

Tests run on Node.js 18.x and 20.x for compatibility.

## Project Structure

```
Portal/
├── index.js              # Entry point
├── package.json          # Dependencies and scripts
├── .env                  # Environment configuration (gitignored)
├── src/
│   ├── Server.js         # Main server logic
│   ├── Portal.js         # Portal server node class
│   ├── Client.js         # Client connection class
│   └── Logger.js         # Structured logging utility
├── test/
│   └── server.test.js    # Test suite
└── .github/
    └── workflows/
        └── test.yml      # CI/CD pipeline
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORTAL_LISTEN_PORT` | Yes | - | Port for HTTP/WebSocket server |
| `PORTAL_REGISTER_KEY` | Yes | - | Authentication key for portal registration |
| `PORTAL_JOIN_KEY` | Yes | - | Authentication key for client joining |
| `LOG_LEVEL` | No | `INFO` | Logging level: `DEBUG`, `INFO`, `WARN`, `ERROR` |

### Logging Levels

- **DEBUG**: Detailed information including all messages
- **INFO**: General informational messages (default)
- **WARN**: Warning messages for unusual but handled situations
- **ERROR**: Error messages for failures and exceptions

## Security Considerations

- Keep `PORTAL_REGISTER_KEY` and `PORTAL_JOIN_KEY` secure
- Use strong, unique keys for production deployments
- Consider implementing TLS/WSS for production environments
- The server includes rate limiting through message validation
- All WebSocket operations include error handling to prevent crashes

## License

ISC

## Author

Schneewolf Labs