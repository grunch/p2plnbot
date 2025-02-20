import { MainContext } from "../../start";

import { User, Dispute, Order } from '../../../models';
import { validateParams, validateObjectId, validateDisputeOrder } from '../../validations';
import * as messages from './messages';
const globalMessages = require('../../messages');
import { logger } from '../../../logger';
import { removeAtSymbol } from '../../../util';

const dispute = async (ctx: MainContext) => {
  try {
    const { user } = ctx;

    const [orderId] = (await validateParams(ctx, 2, '\\<_order id_\\>'))!;
    
    if (!(await validateObjectId(ctx, orderId))) return;
    const order = await validateDisputeOrder(ctx, user, orderId);

    if (order === false) return;
    // Users can't initiate a dispute before this time
    const disputStartWindow = process.env.DISPUTE_START_WINDOW;
    if(disputStartWindow === undefined)
      throw new Error("DISPUTE_START_WINDOW environment variable not defined");
    const secsUntilDispute = parseInt(disputStartWindow);
    const time = new Date();
    time.setSeconds(time.getSeconds() - secsUntilDispute);
    if (order.taken_at !== null && order.taken_at > time) {
      return await messages.disputeTooSoonMessage(ctx);
    }

    const buyer = await User.findOne({ _id: order.buyer_id });
    if(buyer === null)
      throw new Error("buyer was not found");
    const seller = await User.findOne({ _id: order.seller_id });
    if(seller === null)
      throw new Error("seller was not found");
    let initiator: ('seller' | 'buyer') = 'seller';
    if (user._id == order.buyer_id) initiator = 'buyer';

    order.previous_dispute_status = order.status;
    if(initiator === 'seller')
      order.seller_dispute = true;
    else
      order.buyer_dispute = true;
    order.status = 'DISPUTE';
    const sellerToken = Math.floor(Math.random() * 899 + 100);
    const buyerToken = Math.floor(Math.random() * 899 + 100);
    order.buyer_dispute_token = String(buyerToken);
    order.seller_dispute_token = String(sellerToken);
    await order.save();

    // If this is a non community order, we may ban the user globally
    if (order.community_id) {
      // We increment the number of disputes on both users
      // If a user disputes is equal to MAX_DISPUTES, we ban the user
      const buyerDisputes =
        (await Dispute.count({
          $or: [{ buyer_id: buyer._id }, { seller_id: buyer._id }],
        })) + 1;
      const sellerDisputes =
        (await Dispute.count({
          $or: [{ buyer_id: seller._id }, { seller_id: seller._id }],
        })) + 1;
      const maxDisputes = Number(process.env.MAX_DISPUTES);
      // if MAX_DISPUTES is not specified or can't be parsed as number, following
      // maxDisputes will be NaN and following conditions will be false
      if (buyerDisputes >= maxDisputes) {
        buyer.banned = true;
        await buyer.save();
      }
      if (sellerDisputes >= maxDisputes) {
        seller.banned = true;
        await seller.save();
      }
    }

    const dispute = new Dispute({
      initiator,
      seller_id: seller._id,
      buyer_id: buyer._id,
      community_id: order.community_id,
      status: 'WAITING_FOR_SOLVER',
      order_id: order._id,
    });
    await dispute.save();
    // Send message to both users
    await messages.beginDispute(ctx, initiator, order, buyer, seller);
    // Show the dispute button to solvers
    await messages.takeDisputeButton(ctx, order);
    logger.warning(`Order ${order.id}: User ${user.id} started a dispute!`);
  } catch (error) {
    logger.error(error);
  }
};

const deleteDispute = async (ctx: MainContext) => {
  try {
    const { admin } = ctx;

    let [username, orderId] = (await validateParams(
      ctx,
      3,
      '\\<_username_\\> \\<_order id_\\>'
    ))!;

    if (!username) return;
    if (!orderId) return;

    if (!(await validateObjectId(ctx, orderId))) return;
    const order = await Order.findOne({ _id: orderId });

    if (!order) {
      return await globalMessages.notActiveOrderMessage(ctx);
    }
    username = removeAtSymbol(username);
    const user = await User.findOne({ username });
    if (!user) {
      return await globalMessages.notFoundUserMessage(ctx);
    }
    const dispute = await Dispute.findOne({
      order_id: orderId,
    });
    if (!dispute) {
      return await messages.notFoundDisputeMessage(ctx);
    }
    // We check if this is a solver, the order must be from the same community
    if (!admin.admin) {
      if (!order.community_id) {
        return await globalMessages.notAuthorized(ctx);
      }

      if (order.community_id != admin.default_community_id) {
        return await globalMessages.notAuthorized(ctx);
      }

      // We check if this dispute is from a community we validate that
      // the solver is running this command
      if (dispute && dispute.solver_id != admin._id) {
        return await globalMessages.notAuthorized(ctx);
      }
    }

    if (user._id == dispute.buyer_id) dispute.buyer_id = null;
    if (user._id == dispute.seller_id) dispute.seller_id = null;
    await dispute.save();

    await ctx.reply(ctx.i18n.t('operation_successful'));
  } catch (error) {
    logger.error(error);
  }
};

export { dispute, deleteDispute };
