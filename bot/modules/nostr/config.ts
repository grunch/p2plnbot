const notsrPure = require('nostr-tools/pure');
const { SimplePool } = require('nostr-tools/pool');

const sk = process.env.NOSTR_SK || notsrPure.generateSecretKey();
const pk = notsrPure.getPublicKey(sk);

export const getPrivateKey = () => sk;
export const getPublicKey = () => pk;

export const pool = new SimplePool();
const relays = (env => {
  if (!env.RELAYS) return [];
  return env.RELAYS.split(',');
})(process.env);

export const addRelay = (relay: string) => {
  relays.push(relay);
  relays.map(relay => pool.ensureRelay(relay));
};
export const getRelays = () => relays;
