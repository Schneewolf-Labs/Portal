const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const Client = require('./Client');
const Portal = require('./Portal');
const logger = require('./Logger');

// Close codes sent to peers so integrators can tell why they were dropped
const CLOSE_CODES = {
	POLICY_VIOLATION: 1008, // invalid key, bad handshake message
	SERVER_SHUTDOWN: 1001,
	PORTAL_GONE: 1012, // the portal a client was attached to disconnected
	TRY_AGAIN_LATER: 1013 // server at capacity or IP throttled
};

class Server {
	constructor(config) {
		this._config = config;
		this._registerKeyHash = Server._hashKey(config.registerKey);
		this._joinKeyHash = Server._hashKey(config.joinKey);

		this._portals = [];
		this._portalByWS = new Map();
		this._clientsByWS = new Map();
		this._pendingByWS = new Map(); // unauthenticated sockets -> auth timeout handle
		this._authFailuresByIP = new Map(); // ip -> { count, windowStart }
		this._heartbeatTimer = null;

		this._server = http.createServer((req, res) => this._handleHttp(req, res));
		this._wss = new WebSocket.Server({
			server: this._server,
			maxPayload: config.maxPayloadBytes
		});

		this._wss.on('connection', (ws, req) => this._handleConnection(ws, req));
	}

	start(callback) {
		this._server.listen(this._config.port, () => {
			logger.info('Portal Server listening on %d', this._server.address().port);
			this._heartbeatTimer = setInterval(() => this._sweepConnections(), this._config.heartbeatIntervalMs);
			if (callback) callback();
		});
	}

	stop(callback) {
		if (this._heartbeatTimer) {
			clearInterval(this._heartbeatTimer);
			this._heartbeatTimer = null;
		}
		for (const timeout of this._pendingByWS.values()) {
			clearTimeout(timeout);
		}
		this._pendingByWS.clear();
		for (const ws of this._wss.clients) {
			ws.close(CLOSE_CODES.SERVER_SHUTDOWN, 'server shutting down');
		}
		this._wss.close(() => {
			this._server.close(callback);
		});
	}

	// --- HTTP endpoints (health/metrics only, no framework needed) ---

	_handleHttp(req, res) {
		const sendJSON = (status, body) => {
			res.writeHead(status, {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store'
			});
			res.end(JSON.stringify(body));
		};

		if (req.method !== 'GET') {
			sendJSON(405, { error: 'method not allowed' });
			return;
		}
		const path = req.url.split('?')[0];
		switch (path) {
			case '/health':
				sendJSON(200, {
					status: 'healthy',
					uptime: process.uptime(),
					timestamp: new Date().toISOString()
				});
				break;
			case '/status':
				sendJSON(200, {
					portals: this._portals.length,
					clients: this._clientsByWS.size,
					portalStats: this._portals.map((portal) => ({ clientCount: portal.clients.length })),
					uptime: process.uptime(),
					timestamp: new Date().toISOString()
				});
				break;
			default:
				sendJSON(404, { error: 'not found' });
		}
	}

	// --- WebSocket lifecycle ---

	_handleConnection(ws, req) {
		const ip = req.socket.remoteAddress || 'unknown';

		if (this._wss.clients.size > this._config.maxConnections) {
			logger.warn('Rejecting connection from %s: server at capacity', ip);
			ws.close(CLOSE_CODES.TRY_AGAIN_LATER, 'server at capacity');
			return;
		}
		if (this._isThrottled(ip)) {
			logger.warn('Rejecting connection from %s: too many failed auth attempts', ip);
			ws.close(CLOSE_CODES.TRY_AGAIN_LATER, 'too many failed attempts, try again later');
			return;
		}

		logger.info('New connection from %s', ip);
		ws.isAlive = true;
		ws.on('pong', () => { ws.isAlive = true; });

		// Unauthenticated sockets must register or join before the timeout
		const authTimeout = setTimeout(() => {
			this._pendingByWS.delete(ws);
			logger.warn('Closing connection from %s: authentication timeout', ip);
			ws.close(CLOSE_CODES.POLICY_VIOLATION, 'authentication timeout');
		}, this._config.authTimeoutMs);
		this._pendingByWS.set(ws, authTimeout);

		ws.on('message', (msg) => this._handleMessage(ws, ip, msg));
		ws.on('error', (err) => logger.error('WS error from %s: %s', ip, err.message));
		ws.on('close', () => this._handleClose(ws));
	}

	_handleClose(ws) {
		const pendingTimeout = this._pendingByWS.get(ws);
		if (pendingTimeout !== undefined) {
			clearTimeout(pendingTimeout);
			this._pendingByWS.delete(ws);
			logger.info('Unauthenticated connection closed');
			return;
		}

		const portal = this._portalByWS.get(ws);
		if (portal) {
			this._portalByWS.delete(ws);
			const index = this._portals.indexOf(portal);
			if (index !== -1) this._portals.splice(index, 1);
			// Drop the portal's clients; they must rejoin to be reassigned
			for (const client of portal.clients.slice()) {
				this._clientsByWS.delete(client.ws);
				client.ws.close(CLOSE_CODES.PORTAL_GONE, 'portal disconnected');
			}
			logger.info('Portal disconnected (%d remaining)', this._portals.length);
			return;
		}

		const client = this._clientsByWS.get(ws);
		if (client) {
			this._clientsByWS.delete(ws);
			if (client.portal) {
				client.portal.removeClient(client);
			}
			logger.info('Client disconnected');
			return;
		}

		logger.warn('Unknown websocket disconnected');
	}

	// --- Message routing ---

	_handleMessage(ws, ip, msg) {
		let data;
		try {
			data = JSON.parse(msg);
		} catch (e) {
			logger.warn('Dropping message from %s: invalid JSON', ip);
			return;
		}
		if (!data || typeof data !== 'object' || Array.isArray(data)) {
			logger.warn('Dropping message from %s: not a JSON object', ip);
			return;
		}

		const portal = this._portalByWS.get(ws);
		if (portal) {
			// Data from a portal is relayed to the client it addresses
			portal.relay(data);
			return;
		}

		const client = this._clientsByWS.get(ws);
		if (client) {
			// Clients may not send reserved control events; portals would
			// otherwise be unable to tell them apart from server messages
			if (typeof data.event === 'string' && data.event.startsWith('portal:')) {
				logger.warn('Dropping client message with reserved event "%s"', data.event);
				return;
			}
			if (client.portal) {
				client.portal.send(client, data);
			} else {
				logger.error('Client not assigned to portal');
			}
			return;
		}

		this._handleHandshake(ws, ip, data);
	}

	_handleHandshake(ws, ip, data) {
		const { event, key } = data;
		if (typeof event !== 'string' || typeof key !== 'string') {
			logger.warn('Invalid handshake from %s: missing event or key', ip);
			ws.close(CLOSE_CODES.POLICY_VIOLATION, 'expected {"event", "key"} handshake');
			return;
		}

		switch (event) {
			case 'portal:register':
				if (this._keyMatches(key, this._registerKeyHash)) {
					this._clearAuthTimeout(ws);
					const portal = new Portal(ws);
					this._portals.push(portal);
					this._portalByWS.set(ws, portal);
					logger.info('Registered new portal (%d total)', this._portals.length);
					portal.sendControl({ event: 'portal:registered', success: true });
				} else {
					this._rejectAuth(ws, ip, 'registration');
				}
				break;
			case 'portal:join':
				if (this._keyMatches(key, this._joinKeyHash)) {
					const client = new Client(ws);
					const portal = this._getLeastPopulatedPortal();
					if (portal) {
						this._clearAuthTimeout(ws);
						portal.addClient(client);
						this._clientsByWS.set(ws, client);
						logger.info('Client %s joined portal', client.id);
						this._safeSend(ws, { event: 'portal:joined', success: true, clientID: client.id });
					} else {
						logger.warn('Rejecting client join from %s: no portals available', ip);
						ws.close(CLOSE_CODES.TRY_AGAIN_LATER, 'no portals available');
					}
				} else {
					this._rejectAuth(ws, ip, 'join');
				}
				break;
			default:
				logger.warn('Unknown handshake event from %s: %s', ip, event);
				ws.close(CLOSE_CODES.POLICY_VIOLATION, 'unknown event');
		}
	}

	_rejectAuth(ws, ip, kind) {
		logger.warn('Invalid %s key from %s', kind, ip);
		this._recordAuthFailure(ip);
		ws.close(CLOSE_CODES.POLICY_VIOLATION, 'invalid key');
	}

	_clearAuthTimeout(ws) {
		const timeout = this._pendingByWS.get(ws);
		if (timeout !== undefined) {
			clearTimeout(timeout);
			this._pendingByWS.delete(ws);
		}
	}

	// --- Authentication helpers ---

	static _hashKey(key) {
		return crypto.createHash('sha256').update(key).digest();
	}

	// Constant-time comparison; hashing first makes lengths equal so
	// timingSafeEqual can be used and no length information leaks
	_keyMatches(providedKey, expectedHash) {
		return crypto.timingSafeEqual(Server._hashKey(providedKey), expectedHash);
	}

	_recordAuthFailure(ip) {
		const now = Date.now();
		const entry = this._authFailuresByIP.get(ip);
		if (!entry || now - entry.windowStart > 60000) {
			this._authFailuresByIP.set(ip, { count: 1, windowStart: now });
		} else {
			entry.count++;
		}
	}

	_isThrottled(ip) {
		const entry = this._authFailuresByIP.get(ip);
		if (!entry) return false;
		if (Date.now() - entry.windowStart > 60000) {
			this._authFailuresByIP.delete(ip);
			return false;
		}
		return entry.count >= this._config.maxAuthFailuresPerMinute;
	}

	// --- Liveness ---

	// Terminate peers that failed to answer the previous protocol-level ping,
	// then ping everyone again. Portals also get the documented JSON heartbeat.
	_sweepConnections() {
		for (const ws of this._wss.clients) {
			if (ws.isAlive === false) {
				logger.warn('Terminating unresponsive connection');
				ws.terminate();
				continue;
			}
			ws.isAlive = false;
			ws.ping();
		}
		for (const portal of this._portals) {
			portal.sendControl({ event: 'portal:heartbeat' });
		}
	}

	_getLeastPopulatedPortal() {
		let leastPopulated = null;
		for (const portal of this._portals) {
			if (leastPopulated === null || portal.clients.length < leastPopulated.clients.length) {
				leastPopulated = portal;
			}
		}
		return leastPopulated;
	}

	_safeSend(ws, data) {
		try {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify(data));
			}
		} catch (error) {
			logger.error('Error sending WebSocket message: %s', error.message);
		}
	}
}

module.exports = Server;
