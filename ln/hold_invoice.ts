import { createHash, randomBytes } from 'crypto';
import lightning from 'lightning';
import lnd from './connect';
import { logger } from '../logger';

const createHoldInvoice = async ({ description, amount }: { description: string, amount: number }) => {
  try {
    const randomSecret = () => randomBytes(32);
    const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
    // We create a random secret
    const secret = randomSecret();
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + 3600);

    const hash = sha256(secret);
    const holdInvoiceCltvDelta = process.env.HOLD_INVOICE_CLTV_DELTA;
    // sticking to semantics of JS code as requiring HOLD_INVOICE_CLTV_DELTA to be defined breaks tests
    const cltv_delta = holdInvoiceCltvDelta === undefined ? NaN : parseInt(holdInvoiceCltvDelta);
    const { request, id } = await lightning.createHodlInvoice({
      cltv_delta,
      lnd,
      description,
      id: hash,
      tokens: amount,
      expires_at: expiresAt.toISOString(),
    });

    // We sent back the response hash (id) to be used on testing
    return { request, hash: id, secret: secret.toString('hex') };
  } catch (error) {
    logger.error(error);
  }
};

const settleHoldInvoice = async ({ secret }: { secret: string }) => {
  try {
    await lightning.settleHodlInvoice({ lnd, secret });
  } catch (error) {
    logger.error(error);
  }
};

const cancelHoldInvoice = async ({ hash }: { hash: string }) => {
  try {
    await lightning.cancelHodlInvoice({ lnd, id: hash });
  } catch (error) {
    logger.error(error);
  }
};

const getInvoice = async ({ hash }: { hash: string }) => {
  try {
    return await lightning.getInvoice({ lnd, id: hash });
  } catch (error) {
    logger.error(error);
  }
};

export {
  createHoldInvoice,
  settleHoldInvoice,
  cancelHoldInvoice,
  getInvoice,
};
