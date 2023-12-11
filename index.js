require('dotenv').config();
const port = process.env.PORTAL_LISTEN_PORT || 3069;
const registerKey = process.env.PORTAL_REGISTER_KEY || '1234567890';
const joinKey = process.env.PORTAL_JOIN_KEY || '1234567890';

const Server = require('./src/Server');
const server = new Server(port, registerKey, joinKey);

console.log('Starting Portal Server');
server.start();