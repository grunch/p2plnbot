import { getInvoices } from 'lightning';
import lnd from './connect';
import { subscribeInvoice } from './subscribe_invoice';
import { Order } from '../models';
import { logger } from '../logger';
import { CommunityContext } from '../bot/modules/community/communityContext';
import { Telegraf } from 'telegraf';

const resubscribeInvoices = async (bot: Telegraf<CommunityContext>) => {
  try {
    let invoicesReSubscribed = 0;
    
    const unconfirmedInvoices = (
      await getInvoices({
        lnd,
        is_unconfirmed: true,
      })
    ).invoices;
    if (Array.isArray(unconfirmedInvoices) && unconfirmedInvoices.length > 0) {
      const heldInvoices = unconfirmedInvoices.filter(invoice => !!invoice.is_held);
      for (const invoice of heldInvoices) {
        const orderInDB = await Order.findOne({ hash: invoice.id });
        if (orderInDB) {
          logger.info(
            `Re-subscribing Order ${orderInDB._id} - Invoice with hash ${invoice.id} is being held!`
          );
          await subscribeInvoice(bot, invoice.id, true);
          invoicesReSubscribed++;
        }
      }
    }
    logger.info(`Invoices resubscribed: ${invoicesReSubscribed}`);
  } catch (error: any) {
    logger.error(`ResubscribeInvoice catch: ${error.toString()}`);
    return false;
  }
};

export { resubscribeInvoices };
