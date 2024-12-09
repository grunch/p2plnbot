import { getDisputeChannel, getDetailedOrder, sanitizeMD } from '../../../util';
import { logger } from '../../../logger';
import { MainContext } from '../../start';
import { IOrder } from '../../../models/order';
import { UserDocument } from '../../../models/user';

export const beginDispute = async (
  ctx: MainContext, 
  initiator: ('seller' | 'buyer'), 
  order: IOrder, 
  buyer: UserDocument, 
  seller: UserDocument
) => {
  try {
    let initiatorUser = buyer;
    let counterPartyUser = seller;

    if (initiator === 'seller') {
      initiatorUser = seller;
      counterPartyUser = buyer;
    }
    if (initiator === 'buyer') {
      await ctx.telegram.sendMessage(
        initiatorUser.tg_id,
        ctx.i18n.t('dispute_started', {
          who: ctx.i18n.t('you_started', { orderId: order._id }),
          token: order.buyer_dispute_token,
        })
      );
      await ctx.telegram.sendMessage(
        counterPartyUser.tg_id,
        ctx.i18n.t('dispute_started', {
          who: ctx.i18n.t('counterpart_started', { orderId: order._id }),
          token: order.seller_dispute_token,
        })
      );
    } else {
      await ctx.telegram.sendMessage(
        initiatorUser.tg_id,
        ctx.i18n.t('dispute_started', {
          who: ctx.i18n.t('you_started', { orderId: order._id }),
          token: order.seller_dispute_token,
        })
      );
      await ctx.telegram.sendMessage(
        counterPartyUser.tg_id,
        ctx.i18n.t('dispute_started', {
          who: ctx.i18n.t('counterpart_started', { orderId: order._id }),
          token: order.buyer_dispute_token,
        })
      );
    }
  } catch (error) {
    logger.error(error);
  }
};

export const takeDisputeButton = async (ctx: MainContext, order: IOrder) => {
  try {
    const disputeChannel = await getDisputeChannel(order);
    if(disputeChannel === undefined)
      throw new Error("disputeChannel is undefined")
    await ctx.telegram.sendMessage(disputeChannel, ctx.i18n.t('new_dispute'), {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: ctx.i18n.t('take_dispute'),
              callback_data: `takeDispute_${order._id}`,
            },
          ],
        ],
      },
    });
  } catch (error) {
    logger.error(error);
  }
};

export const disputeData = async (
  ctx: MainContext,
  buyer: UserDocument,
  seller: UserDocument,
  order: IOrder,
  initiator: ('seller' | 'buyer'),
  solver: UserDocument,
  buyerDisputes: any,
  sellerDisputes: any
) => {
  try {
    const type =
      initiator === 'seller' ? ctx.i18n.t('seller') : ctx.i18n.t('buyer');
    let initiatorUser = buyer;
    let counterPartyUser = seller;
    if (initiator === 'seller') {
      initiatorUser = seller;
      counterPartyUser = buyer;
    }

    const detailedOrder = getDetailedOrder(ctx.i18n, order, buyer, seller);

    // Fix Issue 543: Escape underscores in usernames
    const escapedInitiatorUsername = sanitizeMD(initiatorUser.username);
    const escapedCounterPartyUsername = sanitizeMD(counterPartyUser.username);

    const message = ctx.i18n.t('dispute_started_channel', {
      initiatorUser: escapedInitiatorUsername,
      initiatorTgId: initiatorUser.tg_id,
      counterPartyUser: escapedCounterPartyUsername,
      counterPartyUserTgId: counterPartyUser.tg_id,
      buyer,
      seller,
      buyerDisputes,
      sellerDisputes,
      detailedOrder,
      type,
      sellerToken: order.seller_dispute_token,
      buyerToken: order.buyer_dispute_token,
    });
    console.log(`Contens of message:\n${message}`);
    await ctx.telegram.sendMessage(solver.tg_id, message, {
      parse_mode: 'MarkdownV2',
    });
    // message to both parties letting them know the dispute
    // has been taken by a solver
    await ctx.telegram.sendMessage(
      buyer.tg_id,
      ctx.i18n.t('dispute_solver', {
        solver: solver.username,
        token: order.buyer_dispute_token,
      })
    );
    await ctx.telegram.sendMessage(
      seller.tg_id,
      ctx.i18n.t('dispute_solver', {
        solver: solver.username,
        token: order.seller_dispute_token,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

export const notFoundDisputeMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('not_found_dispute'));
  } catch (error) {
    logger.error(error);
  }
};

export const sellerReleased = async (ctx: MainContext, solver: UserDocument) => {
  try {
    await ctx.telegram.sendMessage(
      solver.tg_id,
      ctx.i18n.t('seller_already_released')
    );
  } catch (error) {
    logger.error(error);
  }
};

export const disputeTooSoonMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('dispute_too_soon'));
  } catch (error) {
    logger.error(error);
  }
};
