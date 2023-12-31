class Portal {
	constructor(ws) {
		this.ws = ws;
		this.clients = [];
		// ping the portal ws every 30 seconds to keep it alive
		this._pingInterval = setInterval(() => {
			this.ws.send(JSON.stringify({
				event: 'portal:heartbeat'
			}));
		}, 30000);
	}

	addClient(client) {
		this.clients.push(client);
		client.portal = this;
	}

	removeClient(client) {
		const index = this.clients.indexOf(client);
		if (index !== -1) {
			this.clients.splice(index, 1);
		}
		client.portal = null;
		// Signal portal that client was removed/disconnected
		this.ws.send(JSON.stringify({
			_clientID: client.id,
			event: 'portal:client:disconnect'
		}));
	}

	// allows clients to send data to the portal
	send(client, data) {
		const clientID = client.id;
		data._clientID = clientID;
		this.ws.send(JSON.stringify(data));
	}

	// allows the portal to send data to a specific client
	relay(data) {
		const clientID = data._clientID;
		const client = this._getClientByID(clientID);
		if (client) {
			// strip the _clientID from the data before sending it to the client
			data._clientID = undefined;
			client.ws.send(JSON.stringify(data));
		} else {
			console.error('Client not found');
		}
	}

	_getClientByID(clientID) {
		for (let i = 0; i < this.clients.length; i++) {
			const client = this.clients[i];
			if (client.id === clientID) {
				return client;
			}
		}
		return null;
	}
}

module.exports = Portal;