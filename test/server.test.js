const { expect } = require('chai');
const WebSocket = require('ws');
const Server = require('../src/Server');

describe('Portal Server', function() {
	let server;
	const port = 3099;
	const registerKey = 'test-register-key';
	const joinKey = 'test-join-key';

	beforeEach(function(done) {
		server = new Server(port, registerKey, joinKey);
		server.start();
		// Give server time to start
		setTimeout(done, 100);
	});

	afterEach(function(done) {
		server.stop();
		// Give server time to stop
		setTimeout(done, 100);
	});

	describe('Health Endpoints', function() {
		it('should respond to /health endpoint', function(done) {
			const http = require('http');
			const options = {
				hostname: 'localhost',
				port: port,
				path: '/health',
				method: 'GET'
			};

			const req = http.request(options, (res) => {
				let data = '';
				res.on('data', (chunk) => {
					data += chunk;
				});
				res.on('end', () => {
					const response = JSON.parse(data);
					expect(response.status).to.equal('healthy');
					expect(response).to.have.property('uptime');
					expect(response).to.have.property('timestamp');
					done();
				});
			});

			req.on('error', done);
			req.end();
		});

		it('should respond to /status endpoint', function(done) {
			const http = require('http');
			const options = {
				hostname: 'localhost',
				port: port,
				path: '/status',
				method: 'GET'
			};

			const req = http.request(options, (res) => {
				let data = '';
				res.on('data', (chunk) => {
					data += chunk;
				});
				res.on('end', () => {
					const response = JSON.parse(data);
					expect(response).to.have.property('portals');
					expect(response).to.have.property('clients');
					expect(response).to.have.property('portalStats');
					expect(response).to.have.property('uptime');
					done();
				});
			});

			req.on('error', done);
			req.end();
		});
	});

	describe('Portal Registration', function() {
		it('should accept valid portal registration', function(done) {
			const ws = new WebSocket(`ws://localhost:${port}`);

			ws.on('open', () => {
				ws.send(JSON.stringify({
					event: 'portal:register',
					key: registerKey
				}));
			});

			ws.on('message', (data) => {
				const message = JSON.parse(data);
				if (message.event === 'portal:registered') {
					expect(message.success).to.be.true;
					ws.close();
					done();
				}
			});

			ws.on('error', done);
		});

		it('should reject invalid portal registration key', function(done) {
			const ws = new WebSocket(`ws://localhost:${port}`);

			ws.on('open', () => {
				ws.send(JSON.stringify({
					event: 'portal:register',
					key: 'invalid-key'
				}));
			});

			ws.on('close', () => {
				done();
			});

			ws.on('error', done);
		});
	});

	describe('Client Join', function() {
		let portalWs;

		beforeEach(function(done) {
			// Register a portal first
			portalWs = new WebSocket(`ws://localhost:${port}`);
			portalWs.on('open', () => {
				portalWs.send(JSON.stringify({
					event: 'portal:register',
					key: registerKey
				}));
			});
			portalWs.on('message', (data) => {
				const message = JSON.parse(data);
				if (message.event === 'portal:registered') {
					done();
				}
			});
		});

		afterEach(function() {
			if (portalWs) {
				portalWs.close();
			}
		});

		it('should accept valid client join', function(done) {
			const clientWs = new WebSocket(`ws://localhost:${port}`);

			clientWs.on('open', () => {
				clientWs.send(JSON.stringify({
					event: 'portal:join',
					key: joinKey
				}));
			});

			clientWs.on('message', (data) => {
				const message = JSON.parse(data);
				if (message.event === 'portal:joined') {
					expect(message.success).to.be.true;
					expect(message).to.have.property('clientID');
					clientWs.close();
					done();
				}
			});

			clientWs.on('error', done);
		});

		it('should reject invalid client join key', function(done) {
			const clientWs = new WebSocket(`ws://localhost:${port}`);

			clientWs.on('open', () => {
				clientWs.send(JSON.stringify({
					event: 'portal:join',
					key: 'invalid-key'
				}));
			});

			clientWs.on('close', () => {
				done();
			});

			clientWs.on('error', done);
		});
	});

	describe('Message Validation', function() {
		it('should reject invalid JSON', function(done) {
			const ws = new WebSocket(`ws://localhost:${port}`);

			ws.on('open', () => {
				ws.send('invalid json');
				// If server doesn't crash, test passes
				setTimeout(() => {
					ws.close();
					done();
				}, 100);
			});

			ws.on('error', done);
		});

		it('should reject non-object messages', function(done) {
			const ws = new WebSocket(`ws://localhost:${port}`);

			ws.on('open', () => {
				ws.send(JSON.stringify("string message"));
				// If server doesn't crash, test passes
				setTimeout(() => {
					ws.close();
					done();
				}, 100);
			});

			ws.on('error', done);
		});

		it('should reject messages without event field', function(done) {
			const ws = new WebSocket(`ws://localhost:${port}`);

			ws.on('open', () => {
				ws.send(JSON.stringify({
					key: registerKey
				}));
			});

			ws.on('close', () => {
				done();
			});

			ws.on('error', done);
		});
	});
});
