const WebSocket = require('ws');
const logger = require('./Logger');

// A registered portal endpoint and the set of clients assigned to it.
// Liveness pings are handled centrally by the Server heartbeat sweep.
class Portal {
	constructor(ws) {
		this.ws = ws;
		this.clients = [];
		this._clientsById = new Map();
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
		this.sendControl({
			event: 'portal:client:disconnect',
			_clientID: client.id
		});
	}

	// Forward a client's message to this portal, tagged with the sender's ID
	send(client, data) {
		data._clientID = client.id;
		this._safeSend(this.ws, data);
	}

	// Send a server control message to this portal
	sendControl(data) {
		this._safeSend(this.ws, data);
	}

	// Deliver a portal's message to the client addressed by _clientID
	relay(data) {
		const clientID = data._clientID;
		if (!clientID || typeof clientID !== 'string') {
			logger.warn('Dropping portal message: invalid or missing _clientID');
			return;
		}
		const client = this._clientsById.get(clientID);
		if (!client) {
			logger.warn('Dropping portal message: client not found: %s', clientID);
			return;
		}
		delete data._clientID;
		this._safeSend(client.ws, data);
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

module.exports = Portal;
