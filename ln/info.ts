import lightning from 'lightning';
import lnd from './connect';
import { logger } from '../logger';

const getInfo = async () => {
  try {
    return await lightning.getWalletInfo({ lnd });
  } catch (error) {
    logger.error(error);
  }
};

export { getInfo };
