const { expect } = require('chai');
const http = require('http');
const WebSocket = require('ws');
const Server = require('../src/Server');
const { loadConfig } = require('../src/Config');

const port = 3099;
const registerKey = 'test-register-key-0123456789';
const joinKey = 'test-join-key-0123456789';

function makeConfig(overrides = {}) {
	const config = loadConfig({
		PORTAL_LISTEN_PORT: String(port),
		PORTAL_REGISTER_KEY: registerKey,
		PORTAL_JOIN_KEY: joinKey
	});
	return { ...config, ...overrides };
}

function getJSON(path) {
	return new Promise((resolve, reject) => {
		http.get({ hostname: 'localhost', port, path }, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
		}).on('error', reject);
	});
}

function connect() {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://localhost:${port}`);
		ws.on('open', () => resolve(ws));
		ws.on('error', reject);
	});
}

function nextMessage(ws) {
	return new Promise((resolve) => {
		ws.once('message', (data) => resolve(JSON.parse(data)));
	});
}

function closed(ws) {
	return new Promise((resolve) => {
		ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
	});
}

async function registerPortal(ws) {
	ws.send(JSON.stringify({ event: 'portal:register', key: registerKey }));
	return nextMessage(ws);
}

async function joinClient(ws) {
	ws.send(JSON.stringify({ event: 'portal:join', key: joinKey }));
	return nextMessage(ws);
}

describe('Config', function() {
	it('should reject missing keys', function() {
		expect(() => loadConfig({})).to.throw(/PORTAL_REGISTER_KEY/);
	});

	it('should reject short keys', function() {
		expect(() => loadConfig({
			PORTAL_REGISTER_KEY: 'short',
			PORTAL_JOIN_KEY: 'also-short'
		})).to.throw(/at least 16 characters/);
	});

	it('should reject well-known placeholder keys', function() {
		expect(() => loadConfig({
			PORTAL_REGISTER_KEY: '1234567890123456',
			PORTAL_JOIN_KEY: 'your-secure-join-key'
		})).to.throw(/placeholder/);
	});

	it('should reject identical register and join keys', function() {
		expect(() => loadConfig({
			PORTAL_REGISTER_KEY: 'same-key-0123456789',
			PORTAL_JOIN_KEY: 'same-key-0123456789'
		})).to.throw(/must be different/);
	});

	it('should accept valid configuration with defaults', function() {
		const config = makeConfig();
		expect(config.port).to.equal(port);
		expect(config.maxPayloadBytes).to.be.greaterThan(0);
		expect(config.authTimeoutMs).to.be.greaterThan(0);
	});
});

describe('Portal Server', function() {
	let server;
	const sockets = [];

	function track(ws) {
		sockets.push(ws);
		return ws;
	}

	function startServer(config) {
		return new Promise((resolve) => {
			server = new Server(config);
			server.start(resolve);
		});
	}

	afterEach(function(done) {
		for (const ws of sockets.splice(0)) {
			if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
				ws.terminate();
			}
		}
		server.stop(done);
	});

	describe('HTTP endpoints', function() {
		beforeEach(function() {
			return startServer(makeConfig());
		});

		it('should respond to /health', async function() {
			const { statusCode, body } = await getJSON('/health');
			expect(statusCode).to.equal(200);
			expect(body.status).to.equal('healthy');
			expect(body).to.have.property('uptime');
			expect(body).to.have.property('timestamp');
		});

		it('should respond to /status with metrics', async function() {
			const portalWs = track(await connect());
			await registerPortal(portalWs);
			const clientWs = track(await connect());
			await joinClient(clientWs);

			const { statusCode, body } = await getJSON('/status');
			expect(statusCode).to.equal(200);
			expect(body.portals).to.equal(1);
			expect(body.clients).to.equal(1);
			expect(body.portalStats).to.deep.equal([{ clientCount: 1 }]);
		});

		it('should return 404 for unknown paths', async function() {
			const { statusCode } = await getJSON('/nope');
			expect(statusCode).to.equal(404);
		});
	});

	describe('Portal registration', function() {
		beforeEach(function() {
			return startServer(makeConfig());
		});

		it('should accept a valid registration key', async function() {
			const ws = track(await connect());
			const reply = await registerPortal(ws);
			expect(reply.event).to.equal('portal:registered');
			expect(reply.success).to.be.true;
		});

		it('should close with policy violation on an invalid key', async function() {
			const ws = track(await connect());
			ws.send(JSON.stringify({ event: 'portal:register', key: 'wrong-key-0123456789' }));
			const { code, reason } = await closed(ws);
			expect(code).to.equal(1008);
			expect(reason).to.equal('invalid key');
		});
	});

	describe('Client join', function() {
		beforeEach(async function() {
			await startServer(makeConfig());
		});

		it('should accept a valid join key when a portal exists', async function() {
			const portalWs = track(await connect());
			await registerPortal(portalWs);
			const clientWs = track(await connect());
			const reply = await joinClient(clientWs);
			expect(reply.event).to.equal('portal:joined');
			expect(reply.success).to.be.true;
			expect(reply.clientID).to.be.a('string');
		});

		it('should reject an invalid join key', async function() {
			const ws = track(await connect());
			ws.send(JSON.stringify({ event: 'portal:join', key: 'wrong-key-0123456789' }));
			const { code } = await closed(ws);
			expect(code).to.equal(1008);
		});

		it('should reject joins when no portals are available', async function() {
			const ws = track(await connect());
			ws.send(JSON.stringify({ event: 'portal:join', key: joinKey }));
			const { code, reason } = await closed(ws);
			expect(code).to.equal(1013);
			expect(reason).to.equal('no portals available');
		});
	});

	describe('Message relay', function() {
		let portalWs;
		let clientWs;
		let clientID;

		beforeEach(async function() {
			await startServer(makeConfig());
			portalWs = track(await connect());
			await registerPortal(portalWs);
			clientWs = track(await connect());
			({ clientID } = await joinClient(clientWs));
		});

		it('should relay client messages to the portal tagged with _clientID', async function() {
			clientWs.send(JSON.stringify({ event: 'chat', text: 'hello' }));
			const msg = await nextMessage(portalWs);
			expect(msg.event).to.equal('chat');
			expect(msg.text).to.equal('hello');
			expect(msg._clientID).to.equal(clientID);
		});

		it('should relay portal messages to the addressed client without _clientID', async function() {
			portalWs.send(JSON.stringify({ _clientID: clientID, event: 'reply', text: 'hi back' }));
			const msg = await nextMessage(clientWs);
			expect(msg.event).to.equal('reply');
			expect(msg.text).to.equal('hi back');
			expect(msg).to.not.have.property('_clientID');
		});

		it('should not relay client messages that use reserved portal:* events', async function() {
			clientWs.send(JSON.stringify({ event: 'portal:client:disconnect' }));
			clientWs.send(JSON.stringify({ event: 'legit' }));
			// The spoofed message must be dropped, so the next portal message is 'legit'
			const msg = await nextMessage(portalWs);
			expect(msg.event).to.equal('legit');
		});

		it('should notify the portal when a client disconnects', async function() {
			clientWs.close();
			const msg = await nextMessage(portalWs);
			expect(msg.event).to.equal('portal:client:disconnect');
			expect(msg._clientID).to.equal(clientID);
		});

		it('should disconnect clients when their portal disconnects', async function() {
			portalWs.close();
			const { code, reason } = await closed(clientWs);
			expect(code).to.equal(1012);
			expect(reason).to.equal('portal disconnected');
		});
	});

	describe('Hardening', function() {
		it('should close unauthenticated connections after the auth timeout', async function() {
			await startServer(makeConfig({ authTimeoutMs: 200 }));
			const ws = track(await connect());
			const { code, reason } = await closed(ws);
			expect(code).to.equal(1008);
			expect(reason).to.equal('authentication timeout');
		});

		it('should drop connections that exceed the max payload size', async function() {
			await startServer(makeConfig({ maxPayloadBytes: 1024 }));
			const ws = track(await connect());
			await registerPortal(ws);
			ws.send(JSON.stringify({ event: 'big', data: 'x'.repeat(4096) }));
			const { code } = await closed(ws);
			expect(code).to.equal(1009); // message too big
		});

		it('should throttle repeated failed auth attempts from the same IP', async function() {
			await startServer(makeConfig({ maxAuthFailuresPerMinute: 2 }));
			for (let i = 0; i < 2; i++) {
				const ws = track(await connect());
				ws.send(JSON.stringify({ event: 'portal:register', key: 'wrong-key-0123456789' }));
				await closed(ws);
			}
			const ws = track(await connect());
			const { code, reason } = await closed(ws);
			expect(code).to.equal(1013);
			expect(reason).to.match(/too many failed attempts/);
		});

		it('should survive invalid JSON and non-object messages', async function() {
			await startServer(makeConfig());
			const ws = track(await connect());
			ws.send('not json');
			ws.send(JSON.stringify('a string'));
			ws.send(JSON.stringify([1, 2, 3]));
			// Server must still be responsive afterwards
			const { body } = await getJSON('/health');
			expect(body.status).to.equal('healthy');
		});

		it('should close handshakes missing event or key', async function() {
			await startServer(makeConfig());
			const ws = track(await connect());
			ws.send(JSON.stringify({ key: registerKey }));
			const { code } = await closed(ws);
			expect(code).to.equal(1008);
		});
	});
});
