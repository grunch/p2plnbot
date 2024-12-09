import fs from 'fs';
import path from 'path';
import { authenticatedLndGrpc } from 'lightning';
import { logger } from '../logger';

// Trying to load TLS certificate and admin macaroon from environment variables first
let cert = process.env.LND_CERT_BASE64;
let macaroon = process.env.LND_MACAROON_BASE64;

// cert and macaroon paths in case we need it
const certPath = path.resolve(__dirname, '../tls.cert');
const macaroonPath = path.resolve(__dirname, '../admin.macaroon');

if (cert) {
  logger.info('Using TLS cert from environment variable');
}
if (macaroon) {
  logger.info('Using macaroon from environment variable');
}

// If environment variables are not set, try to load them from files
if (!cert && process.env.NODE_ENV !== 'test' && fs.existsSync(certPath)) {
  logger.info('Loading TLS cert from file');
  cert = fs.readFileSync(certPath).toString('base64');
}
if (
  !macaroon &&
  process.env.NODE_ENV !== 'test' &&
  fs.existsSync(macaroonPath)
) {
  logger.info('Loading macaroon from file');
  macaroon = fs.readFileSync(macaroonPath).toString('base64');
}

// Enforcing presence of LND_GRPC_HOST environment variable
const socket = process.env.LND_GRPC_HOST;
if (!socket && process.env.NODE_ENV !== 'test') {
  throw new Error('You must provide a LND_GRPC_HOST environment variable');
}

// Use these credentials to connect to the LND node
const { lnd } = authenticatedLndGrpc({
  cert,
  macaroon,
  socket,
});

export default lnd;
