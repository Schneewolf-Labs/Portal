# Portal

A secure WebSocket relay that acts as a message broker between distributed portal servers and clients. Clients are automatically load-balanced across registered portals, and every message is routed through the relay tagged with the sending client's ID.

## Features

- **Load balancing** — clients are assigned to the least-populated portal
- **Hardened by default** — strong keys enforced at startup, constant-time key comparison, per-IP brute-force throttling, payload size limits, authentication timeouts, and connection caps
- **Liveness detection** — protocol-level ping/pong terminates dead connections; portals also receive a JSON heartbeat
- **Clear close codes** — peers are told *why* they were disconnected (invalid key, capacity, portal gone, etc.)
- **Minimal dependencies** — just `ws` and `dotenv`
- **Observable** — `/health` and `/status` endpoints, structured logging with configurable levels

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Generate keys and create your .env
cp .env.example .env
npm run generate-keys   # paste the output into .env

# 3. Start the server
npm start
```

The server refuses to start without strong keys — there are no insecure defaults. Keys must be at least 16 characters, must not be well-known placeholder values, and the register and join keys must differ.

## Configuration

All configuration is via environment variables (or a `.env` file — see `.env.example`).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORTAL_REGISTER_KEY` | Yes | — | Key portal servers use to register (min 16 chars) |
| `PORTAL_JOIN_KEY` | Yes | — | Key clients use to join (min 16 chars, must differ from register key) |
| `PORTAL_LISTEN_PORT` | No | `3069` | Port for the HTTP/WebSocket server |
| `LOG_LEVEL` | No | `INFO` | `DEBUG`, `INFO`, `WARN`, or `ERROR` |
| `PORTAL_MAX_PAYLOAD_BYTES` | No | `65536` | Max WebSocket message size; larger messages close the connection |
| `PORTAL_MAX_CONNECTIONS` | No | `1000` | Max simultaneous WebSocket connections |
| `PORTAL_AUTH_TIMEOUT_MS` | No | `10000` | Time a connection has to authenticate before being closed |
| `PORTAL_HEARTBEAT_INTERVAL_MS` | No | `30000` | Interval for liveness pings and portal heartbeats |
| `PORTAL_MAX_AUTH_FAILURES_PER_MINUTE` | No | `10` | Failed auth attempts per IP per minute before throttling |

## HTTP endpoints

### `GET /health`

Health check for monitors and load balancers.

```json
{ "status": "healthy", "uptime": 123.456, "timestamp": "2026-06-10T00:00:00.000Z" }
```

### `GET /status`

Metrics about connected portals and clients.

```json
{
  "portals": 2,
  "clients": 5,
  "portalStats": [{ "clientCount": 3 }, { "clientCount": 2 }],
  "uptime": 123.456,
  "timestamp": "2026-06-10T00:00:00.000Z"
}
```

## WebSocket protocol

Connect to `ws://host:port` and authenticate within the auth timeout by sending a handshake message. Events prefixed with `portal:` are reserved for the server; client messages using them are dropped.

### Portal registration

```json
{ "event": "portal:register", "key": "<register key>" }
```

Success response:

```json
{ "event": "portal:registered", "success": true }
```

### Client join

```json
{ "event": "portal:join", "key": "<join key>" }
```

Success response (the client is assigned to the least-populated portal):

```json
{ "event": "portal:joined", "success": true, "clientID": "<uuid>" }
```

If no portals are registered, the connection is closed with code `1013`.

### Message routing

**Client → portal:** every message a client sends is forwarded to its portal with a `_clientID` field identifying the sender:

```json
{ "event": "chat", "text": "hello", "_clientID": "<uuid>" }
```

**Portal → client:** portals address a client by including `_clientID`; the field is stripped before delivery:

```json
{ "_clientID": "<uuid>", "event": "reply", "text": "hi back" }
```

### Server control messages (portal-bound)

Heartbeat, sent every `PORTAL_HEARTBEAT_INTERVAL_MS`:

```json
{ "event": "portal:heartbeat" }
```

Client disconnect notification:

```json
{ "event": "portal:client:disconnect", "_clientID": "<uuid>" }
```

### Close codes

| Code | Meaning |
|------|---------|
| `1001` | Server shutting down |
| `1008` | Policy violation: invalid key, malformed handshake, or authentication timeout (see close reason) |
| `1009` | Message exceeded `PORTAL_MAX_PAYLOAD_BYTES` |
| `1012` | The portal this client was attached to disconnected; rejoin to be reassigned |
| `1013` | Try again later: server at capacity, IP throttled, or no portals available (see close reason) |

## Security notes

- Key comparisons are constant-time (SHA-256 + `crypto.timingSafeEqual`), so neither key contents nor key length leak through timing.
- Failed authentication attempts are throttled per IP (`PORTAL_MAX_AUTH_FAILURES_PER_MINUTE`).
- Unauthenticated sockets are closed after `PORTAL_AUTH_TIMEOUT_MS`, and unresponsive sockets are terminated by the heartbeat sweep.
- Message contents and keys are never written to logs.
- Run behind a TLS-terminating proxy (nginx, Caddy, a cloud load balancer) in production so traffic uses `wss://` — the keys are sent in band and must not traverse the network in cleartext. If the proxy is the only way in, per-IP throttling sees the proxy's address; restrict direct access to the relay accordingly.
- Treat the `/status` endpoint as internal; expose only `/health` publicly if you don't want connection counts visible.

## Development

```bash
npm test
```

The suite covers configuration validation, registration/join authentication, message relay in both directions, reserved-event spoofing protection, disconnect handling, auth timeouts, payload limits, and brute-force throttling.

GitHub Actions runs tests on pushes and pull requests to `main`, `master`, and `develop` on Node.js 18.x and 20.x.

## Project structure

```
Portal/
├── index.js              # Entry point: config loading, startup, graceful shutdown
├── .env.example          # Configuration template
├── scripts/
│   └── generate-keys.js  # Strong key generator (npm run generate-keys)
├── src/
│   ├── Config.js         # Environment validation and defaults
│   ├── Server.js         # HTTP/WebSocket server, auth, routing, hardening
│   ├── Portal.js         # A registered portal and its assigned clients
│   ├── Client.js         # A joined client connection
│   └── Logger.js         # Leveled logging
└── test/
    └── server.test.js    # Test suite
```

## License

ISC

## Author

Schneewolf Labs
