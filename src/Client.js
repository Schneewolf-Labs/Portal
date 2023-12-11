const uuid = require('uuid');

class Client {
	constructor(ws) {
		this.ws = ws;
		this.id = this._generateClientID();
		this.portal = null;
	}

	_generateClientID() {
		return uuid.v4();
	}
}

module.exports = Client;