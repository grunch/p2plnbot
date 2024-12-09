// @ts-check
import { logger } from '../../../logger';
import { Order } from '../../../models';
import { deleteOrderFromChannel } from '../../../util';
import * as messages from '../../messages';
import { HasTelegram, MainContext } from '../../start';
import { validateUserWaitingOrder, isBannedFromCommunity, validateTakeSellOrder, validateSeller, validateObjectId, validateTakeBuyOrder } from '../../validations';
import * as OrderEvents from '../../modules/events/orders';

export const takeOrderActionValidation = async (ctx: MainContext, next: () => void) => {
  try {
    const text = (ctx.update as any).callback_query.message.text;
    if (!text) return;
    next();
  } catch (err) {
    logger.error(err);
  }
};
export const takeOrderValidation = async (ctx: MainContext, next: () => void) => {
  try {
    const { user } = ctx;
    if (!(await validateUserWaitingOrder(ctx, ctx, user))) return;
    next();
  } catch (err) {
    logger.error(err);
  }
};
export const takebuyValidation = async (ctx: MainContext, next: () => void) => {
  try {
    // Sellers with orders in status = FIAT_SENT, have to solve the order
    const isOnFiatSentStatus = await validateSeller(ctx, ctx.user);
    if (!isOnFiatSentStatus) return;
    next();
  } catch (err) {
    logger.error(err);
  }
};
export const takebuy = async (ctx: MainContext, bot: HasTelegram, orderId: string) => {
  try {
    if (!orderId) return;
    const { user } = ctx;
    if (!(await validateObjectId(ctx, orderId))) return;
    const order = await Order.findOne({ _id: orderId });
    if (!order) return;
    // We verify if the user is not banned on this community
    if (await isBannedFromCommunity(user, order.community_id))
      return await messages.bannedUserErrorMessage(ctx, user);

    if (!(await validateTakeBuyOrder(ctx, bot, user, order))) return;
    // We change the status to trigger the expiration of this order
    // if the user don't do anything
    order.status = 'WAITING_PAYMENT';
    order.seller_id = user._id;
    order.taken_at = new Date(Date.now());
    await order.save();
    order.status = 'in-progress';
    OrderEvents.orderUpdated(order);
    // We delete the messages related to that order from the channel
    await deleteOrderFromChannel(order, bot.telegram);
    await messages.beginTakeBuyMessage(ctx, bot, user, order);
  } catch (error) {
    logger.error(error);
  }
};
export const takesell = async (ctx: MainContext, bot: HasTelegram, orderId: string) => {
  try {
    const { user } = ctx;
    if (!orderId) return;
    const order = await Order.findOne({ _id: orderId });
    if (!order) return;
    // We verify if the user is not banned on this community
    if (await isBannedFromCommunity(user, order.community_id))
      return await messages.bannedUserErrorMessage(ctx, user);
    if (!(await validateTakeSellOrder(ctx, bot, user, order))) return;
    order.status = 'WAITING_BUYER_INVOICE';
    order.buyer_id = user._id;
    order.taken_at = new Date(Date.now());

    await order.save();
    order.status = 'in-progress';
    OrderEvents.orderUpdated(order);
    // We delete the messages related to that order from the channel
    await deleteOrderFromChannel(order, bot.telegram);
    await messages.beginTakeSellMessage(ctx, bot, user, order);
  } catch (error) {
    logger.error(error);
  }
};
