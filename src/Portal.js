const logger = require('./Logger');

class Portal {
	constructor(ws) {
		this.ws = ws;
		this.clients = [];
		this._clientsById = new Map(); // Map for O(1) client lookup by ID
		// ping the portal ws every 30 seconds to keep it alive
		this._pingInterval = setInterval(() => {
			this._safeSend(this.ws, {
				event: 'portal:heartbeat'
			});
		}, 30000);
	}

	// Clean up resources when portal is destroyed
	destroy() {
		if (this._pingInterval) {
			clearInterval(this._pingInterval);
			this._pingInterval = null;
		}
	}

	addClient(client) {
		this.clients.push(client);
		this._clientsById.set(client.id, client);
		client.portal = this;
	}

	removeClient(client) {
		const index = this.clients.indexOf(client);
		if (index !== -1) {
			this.clients.splice(index, 1);
		}
		this._clientsById.delete(client.id);
		client.portal = null;
		// Signal portal that client was removed/disconnected
		this._safeSend(this.ws, {
			_clientID: client.id,
			event: 'portal:client:disconnect'
		});
	}

	// allows clients to send data to the portal
	send(client, data) {
		const clientID = client.id;
		data._clientID = clientID;
		this._safeSend(this.ws, data);
	}

	// allows the portal to send data to a specific client
	relay(data) {
		const clientID = data._clientID;

		// Validate clientID is present
		if (!clientID || typeof clientID !== 'string') {
			logger.error('Invalid or missing _clientID in relay message');
			return;
		}

		const client = this._getClientByID(clientID);
		if (client) {
			// strip the _clientID from the data before sending it to the client
			delete data._clientID;
			this._safeSend(client.ws, data);
		} else {
			logger.error('Client not found: ' + clientID);
		}
	}

	_getClientByID(clientID) {
		return this._clientsById.get(clientID) || null;
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

module.exports = Portal;