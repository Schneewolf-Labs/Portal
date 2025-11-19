const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Client = require('./Client');
const Portal = require('./Portal');
const logger = require('./Logger');

class Server {
	constructor(port, registerKey, joinKey) {
		this._port = port;
		this._registerKey = registerKey;
		this._joinKey = joinKey;

		this._portals = [];
		this._portalByWS = new Map();
		this._clientsByWS = new Map();

		this._app = express();
		this._server = http.createServer(this._app);
		this._wss = new WebSocket.Server({ server: this._server });

		// Setup HTTP endpoints
		this._setupRoutes();

		this._wss.on('connection', (ws) => {
			// Server got a new connection
			logger.info('Got new connection');
			ws.on('message', (msg) => {
				this._handleMessage(ws, msg);
			});
			ws.on('error', (err) => {
				logger.error('WS error: ' + err);
			});
			ws.on('close', () => {
				// Check if this ws is a portal
				const isPortal = this._portalByWS.has(ws);
				// Check if this ws is a client
				const isClient = this._clientsByWS.has(ws);
				
				if (isPortal) {
					// Remove portal from portals list
					const portal = this._portalByWS.get(ws);
					const index = this._portals.indexOf(portal);
					this._portals.splice(index, 1);
					// Remove portal from portalByWS map
					this._portalByWS.delete(ws);
					// Remove portal's clients
					portal.clients.forEach((client) => {
						this._clientsByWS.delete(client.ws);
						client.ws.close();
					});
					// Clean up portal resources
					portal.destroy();
					logger.info('Portal disconnected');
				} else if (isClient) {
					// Remove client from clientsByWS map
					const client = this._clientsByWS.get(ws);
					this._clientsByWS.delete(ws);
					// Remove client from portal
					if (client.portal) {
						client.portal.removeClient(client);
					}
					logger.info('Client disconnected')
				} else {
					logger.warn('Unknown websocket disconnected');
				}
			});
		});
	}

	_setupRoutes() {
		// Health check endpoint
		this._app.get('/health', (req, res) => {
			res.status(200).json({
				status: 'healthy',
				uptime: process.uptime(),
				timestamp: new Date().toISOString()
			});
		});

		// Status endpoint with metrics
		this._app.get('/status', (req, res) => {
			const totalClients = Array.from(this._clientsByWS.values()).length;
			const portalStats = this._portals.map(portal => ({
				clientCount: portal.clients.length
			}));

			res.status(200).json({
				portals: this._portals.length,
				clients: totalClients,
				portalStats: portalStats,
				uptime: process.uptime(),
				timestamp: new Date().toISOString()
			});
		});
	}

	start() {
		this._server.listen(this._port, () => {
			logger.info('Portal Server listening on %d', this._server.address().port);
		});
	}

	stop() {
		this._server.close();
	}

	_handleMessage(ws, msg) {
		try {
			logger.debug('Got message: ' + msg);
			const data = JSON.parse(msg);

			// Validate message is an object
			if (!data || typeof data !== 'object') {
				logger.error('Invalid message format: not an object');
				return;
			}

			const portal = this._portalByWS.get(ws);
			const client = this._clientsByWS.get(ws);
			if (portal) { // if this ws is a portal, we are getting data back that needs to be relayed to a client
				portal.relay(data);
				return;
			} else if (client) { // if this ws is a client, we are getting data from the client that needs to be relayed to a portal
				if (client.portal) {
					client.portal.send(client, data);
				} else {
					logger.error('Client not assigned to portal');
				}
				return;
			} else { // in this final state, check if the ws is trying to register as a portal or join as a client
				const event = data.event;
				const key = data.key;

				// Validate event and key are present
				if (!event || typeof event !== 'string') {
					logger.error('Invalid or missing event field');
					ws.close();
					return;
				}

				if (!key || typeof key !== 'string') {
					logger.error('Invalid or missing key field');
					ws.close();
					return;
				}

				switch (event) {
					case 'portal:register':
						logger.info('Got Portal registration request');
						if (key === this._registerKey) {
							logger.info('Registering new portal');
							const portal = new Portal(ws);
							this._portals.push(portal);
							this._portalByWS.set(ws, portal);
							// Send acknowledgment
							this._safeSend(ws, {
								event: 'portal:registered',
								success: true
							});
						} else {
							logger.error('Invalid registration key');
							ws.close();
						}
						break;
					case 'portal:join':
						logger.info('Got Portal join request');
						if (key === this._joinKey) {
							logger.info('Joining portal');
							const client = new Client(ws);
							const portal = this._assignClientToPortal(client);
							if (portal) {
								this._clientsByWS.set(ws, client);
								// Send acknowledgment with client ID
								this._safeSend(ws, {
									event: 'portal:joined',
									success: true,
									clientID: client.id
								});
							} else {
								logger.error('No portals available to join');
								ws.close();
							}
						} else {
							logger.error('Invalid join key');
							ws.close();
						}
						break;
					default:
						logger.error('Unknown event: ' + event);
						ws.close();
						break;
				}
				return;
			}
		} catch (e) {
			logger.error('Error parsing message: ' + e);
		}
	}

	_assignClientToPortal(client) {
		const portal = this._getLeastPopulatedPortal();
		if (portal) {
			portal.addClient(client);
		}
		return portal;
	}

	_getLeastPopulatedPortal() {
		let leastPopulatedPortal = null;
		for (let i = 0; i < this._portals.length; i++) {
			const portal = this._portals[i];
			if (leastPopulatedPortal === null) {
				leastPopulatedPortal = portal;
			} else if (portal.clients.length < leastPopulatedPortal.clients.length) {
				leastPopulatedPortal = portal;
			}
		}
		return leastPopulatedPortal;
	}

	// Safe wrapper for WebSocket send with error handling
	_safeSend(ws, data) {
		try {
			if (ws.readyState === 1) { // 1 = WebSocket.OPEN
				ws.send(JSON.stringify(data));
			} else {
				logger.error('WebSocket is not open. ReadyState: ' + ws.readyState);
			}
		} catch (error) {
			logger.error('Error sending WebSocket message: ' + error.message);
		}
	}

}

module.exports = Server;