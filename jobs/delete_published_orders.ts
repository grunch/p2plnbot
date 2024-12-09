import { Telegraf } from "telegraf";

import { Order } from '../models';
import { deleteOrderFromChannel } from '../util';
import { logger } from '../logger';
import { CommunityContext } from "../bot/modules/community/communityContext";
import { IOrder } from "../models/order";

const deleteOrders = async (bot: Telegraf<CommunityContext>) => {
  try {
    const windowTime = new Date();
    windowTime.setSeconds(
      windowTime.getSeconds() -
        Number(process.env.ORDER_PUBLISHED_EXPIRATION_WINDOW)
    );
    // We get the pending orders where time is expired
    const pendingOrders = await Order.find({
      status: 'PENDING',
      created_at: { $lte: windowTime },
    });
    for (const order of pendingOrders) {
      logger.info(
        `Pending order Id: ${order._id} expired after ${process.env.ORDER_PUBLISHED_EXPIRATION_WINDOW} seconds, deleting it from database and channel`
      );
      const orderCloned = order.toObject() as IOrder;
      // We remove the order from the database first, then we remove the message from the channel
      await order.remove();
      // We delete the messages related to that order from the channel
      await deleteOrderFromChannel(orderCloned, bot.telegram);
    }
  } catch (error) {
    const message = String(error);
    logger.error(`deleteOrders catch error: ${message}`);
  }
};

export default deleteOrders;
