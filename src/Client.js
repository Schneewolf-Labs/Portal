const crypto = require('crypto');

class Client {
	constructor(ws) {
		this.ws = ws;
		this.id = crypto.randomUUID();
		this.portal = null;
	}
}

module.exports = Client;
