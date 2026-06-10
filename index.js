require('dotenv').config();

const { loadConfig } = require('./src/Config');
const Server = require('./src/Server');
const logger = require('./src/Logger');

let config;
try {
	config = loadConfig(process.env);
} catch (err) {
	console.error(err.message);
	process.exit(1);
}

logger.info('Starting Portal Server');
const server = new Server(config);
server.start();

let shuttingDown = false;
function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info('Received %s, shutting down gracefully', signal);
	server.stop(() => process.exit(0));
	// Force exit if connections don't drain in time
	setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
