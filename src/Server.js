const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Client = require('./Client');
const Portal = require('./Portal');

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

		this._wss.on('connection', (ws) => {
			// Server got a new connection
			ws.on('message', (msg) => {
				this._handleMessage(ws, msg);
			});
			ws.on('error', (err) => {
				console.error('WS error: ' + err);
			});
			ws.on('close', () => {
				// TODO: Handle portal and client disconnects
				// Check if this ws is a portal
				// Check if this ws is a client
			});
		});
	}

	start() {
		this._server.listen(this._port, () => {
			console.log('Portal Server listening on %d', this._server.address().port);
		});
	}

	stop() {
		this._server.close();
	}

	_handleMessage(ws, msg) {
		try {
			const data = JSON.parse(msg);
			const portal = this._portalByWS.get(ws);
			const client = this._clientsByWS.get(ws);
			if (portal) { // if this ws is a portal, we are getting data back that needs to be relayed to a client
				portal.relay(ws, data);
				return;
			} else if (client) { // if this ws is a client, we are getting data from the client that needs to be relayed to a portal
				if (client.portal) {
					client.portal.send(client, data);
				} else {
					console.error('Client not assigned to portal');
				}
				return;
			} else { // in this final state, check if the ws is trying to register as a portal or join as a client
				const event = data.event;
				const key = data.key;
				switch (event) {
					case 'portal:register':
						console.log('Got Portal registration request');
						if (key === this._registerKey) {
							console.log('Registering new portal');
							const portal = new Portal(ws);
							this._portals.push(portal);
							this._portalByWS.set(ws, portal);
						} else {
							console.error('Invalid registration key');
							ws.close();
						}
						break;
					case 'portal:join':
						console.log('Got Portal join request');
						if (key === this._joinKey) {
							console.log('Joining portal');
							const client = new Client(ws);
							this._assignClientToPortal(client);
							this._clientsByWS.set(ws, client);
						} else {
							console.error('Invalid join key');
						}
						break;
				}
				return;
			}
		} catch (e) {
			console.error('Error parsing message: ' + e);
		}
	}

	_assignClientToPortal(client) {
		const portal = this._getLeastPopulatedPortal();
		portal.addClient(client);
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

}

module.exports = Server;