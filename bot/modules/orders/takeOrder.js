// @ts-check
const { logger } = require('../../../logger');
const { Order, Block, User } = require('../../../models');
const { deleteOrderFromChannel } = require('../../../util');
const messages = require('../../messages');
const {
  validateUserWaitingOrder,
  isBannedFromCommunity,
  validateTakeSellOrder,
  validateSeller,
  validateObjectId,
  validateTakeBuyOrder,
} = require('../../validations');
const OrderEvents = require('../../modules/events/orders');

exports.takeOrderActionValidation = async (ctx, next) => {
  try {
    const text = ctx.update.callback_query.message.text;
    if (!text) return;
    next();
  } catch (err) {
    logger.error(err);
  }
};
exports.takeOrderValidation = async (ctx, next) => {
  try {
    const { user } = ctx;
    if (!(await validateUserWaitingOrder(ctx, ctx, user))) return;
    next();
  } catch (err) {
    logger.error(err);
  }
};
exports.takebuyValidation = async (ctx, next) => {
  try {
    // Sellers with orders in status = FIAT_SENT, have to solve the order
    const isOnFiatSentStatus = await validateSeller(ctx, ctx.user);
    if (!isOnFiatSentStatus) return;
    next();
  } catch (err) {
    logger.error(err);
  }
};
exports.takebuy = async (ctx, bot, orderId) => {
  try {
    if (!orderId) return;
    const { user } = ctx;
    if (!(await validateObjectId(ctx, orderId))) return;
    const order = await Order.findOne({ _id: orderId });
    if (!order) return;

    const userOffer = await User.findOne({_id: order.buyer_id});

    const userOfferIsBlocked = await Block.exists({ blocker_tg_id: user.tg_id, blocked_tg_id: userOffer.tg_id });
    const takerIsBlocked = await Block.exists({blocker_tg_id: userOffer.tg_id, blocked_tg_id: user.tg_id});

    if (userOfferIsBlocked)
      return await messages.userOrderIsBlockedByUserTaker(ctx, user);

    if (takerIsBlocked)
      return await messages.userTakerIsBlockedByUserOrder(ctx, user);

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
exports.takesell = async (ctx, bot, orderId) => {
  try {
    const { user } = ctx;
    if (!orderId) return;
    const order = await Order.findOne({ _id: orderId });
    if (!order) return;
    const seller = await User.findOne({_id: order.seller_id});

    const sellerIsBlocked = await Block.exists({ blocker_tg_id: user.tg_id, blocked_tg_id: seller.tg_id });
    const buyerIsBlocked = await Block.exists({blocker_tg_id: seller.tg_id, blocked_tg_id: user.tg_id});

    if (sellerIsBlocked)
      return await messages.userOrderIsBlockedByUserTaker(ctx, user);

    if (buyerIsBlocked)
      return await messages.userTakerIsBlockedByUserOrder(ctx, user);

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
