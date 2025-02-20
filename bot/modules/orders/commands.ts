// @ts-check
import { logger } from '../../../logger';
import { Community, Order } from '../../../models';
import { isFloat } from '../../../util';
import { validateBuyOrder, isBannedFromCommunity, validateSeller, validateSellOrder, validateParams } from '../../validations';
import * as messages from '../../messages';
import * as ordersActions from '../../ordersActions';
import { deletedCommunityMessage } from './messages';
import { takebuy, takesell, takebuyValidation } from './takeOrder';

import * as Scenes from './scenes';
import { CommunityContext } from '../community/communityContext';
import { MainContext } from '../../start';
import { UserDocument } from '../../../models/user';
import { ICommunity } from '../../../models/community';
import { Chat } from 'telegraf/typings/core/types/typegram';

interface EnterWizardState {
  community?: ICommunity;
  currency?: string;
  currencies?: string[];
  type: string;
  user: UserDocument;
}

const buyWizard = async (ctx: CommunityContext) => enterWizard(ctx, ctx.user, 'buy');
const sellWizard = async (ctx: CommunityContext) => enterWizard(ctx, ctx.user, 'sell');

const sell = async (ctx: MainContext) => {
  try {
    const user = ctx.user;
    if (await isMaxPending(user))
      return await messages.tooManyPendingOrdersMessage(ctx, user, ctx.i18n);

    // Sellers with orders in status = FIAT_SENT, have to solve the order
    const isOnFiatSentStatus = await validateSeller(ctx, user);

    if (!isOnFiatSentStatus) return;

    const sellOrderParams = await validateSellOrder(ctx);

    if (!sellOrderParams) return;
    const { amount, fiatAmount, fiatCode, paymentMethod } = sellOrderParams;
    let priceMargin = sellOrderParams.priceMargin;
    priceMargin = isFloat(priceMargin)
      ? parseFloat(priceMargin.toFixed(2))
      : parseInt(priceMargin);
    let communityId = null;
    let community = null;
    // If this message came from a group
    // We check if the there is a community for it
    if (ctx.message?.chat.type !== 'private') {
      // Allow find communities case insensitive
      const regex = new RegExp(
        ['^', '@' + (ctx.message?.chat as Chat.UserNameChat).username, '$'].join(''),
        'i'
      );
      community = await Community.findOne({ group: regex });
      if (!community) return ctx.deleteMessage();

      communityId = community._id;
    } else if (user.default_community_id) {
      communityId = user.default_community_id;
      community = await Community.findOne({ _id: communityId });
      if (!community) {
        user.default_community_id = undefined;
        await user.save();
        return deletedCommunityMessage(ctx);
      }
    }
    // We verify if the user is not banned on this community
    if (await isBannedFromCommunity(user, communityId))
      return await messages.bannedUserErrorMessage(ctx, user);

    // If the user is in a community, we need to check if the currency is supported
    if (!!community && !community.currencies.includes(fiatCode))
      return await messages.currencyNotSupportedMessage(
        ctx,
        community.currencies
      );

    // @ts-ignore
    const order = await ordersActions.createOrder(ctx.i18n, ctx, user, {
      type: 'sell',
      amount,
      fiatAmount,
      fiatCode,
      paymentMethod,
      status: 'PENDING',
      priceMargin,
      community_id: communityId,
    });
    if (order)
      await messages.publishSellOrderMessage(ctx, user, order, ctx.i18n, true);
  } catch (error) {
    logger.error(error);
  }
};

const buy = async (ctx: MainContext) => {
  try {
    const user = ctx.user;
    if (await isMaxPending(user))
      return await messages.tooManyPendingOrdersMessage(ctx, user, ctx.i18n);

    const buyOrderParams = await validateBuyOrder(ctx);
    if (!buyOrderParams) return;

    const { amount, fiatAmount, fiatCode, paymentMethod } = buyOrderParams;
    let priceMargin = buyOrderParams.priceMargin;
    priceMargin = isFloat(priceMargin)
      ? parseFloat(priceMargin.toFixed(2))
      : parseInt(priceMargin);
    let communityId = null;
    let community = null;
    // If this message came from a group
    // We check if the there is a community for it
    if (ctx.message?.chat.type !== 'private') {
      // Allow find communities case insensitive
      const regex = new RegExp(
        ['^', '@' + (ctx.message?.chat as Chat.UserNameChat).username, '$'].join(''),
        'i'
      );
      community = await Community.findOne({ group: regex });
      if (!community) {
        ctx.deleteMessage();
        return;
      }
      communityId = community._id;
    } else if (user.default_community_id) {
      communityId = user.default_community_id;
      community = await Community.findOne({ _id: communityId });
      if (!community) {
        user.default_community_id = undefined;
        await user.save();
        return deletedCommunityMessage(ctx);
      }
    }
    // We verify if the user is not banned on this community
    if (await isBannedFromCommunity(user, communityId))
      return await messages.bannedUserErrorMessage(ctx, user);

    // If the user is in a community, we need to check if the currency is supported
    if (!!community && !community.currencies.includes(fiatCode)) {
      await messages.currencyNotSupportedMessage(ctx, community.currencies);
      return;
    }
    // @ts-ignore
    const order = await ordersActions.createOrder(ctx.i18n, ctx, user, {
      type: 'buy',
      amount,
      fiatAmount,
      fiatCode,
      paymentMethod,
      status: 'PENDING',
      priceMargin,
      community_id: communityId,
    });

    if (order) {
      await messages.publishBuyOrderMessage(ctx, user, order, ctx.i18n, true);
    }
  } catch (error) {
    logger.error(error);
  }
};

async function enterWizard(ctx: CommunityContext, user: UserDocument, type: string) {
  const state: EnterWizardState = {
    type,
    user,
  };
  if (user.default_community_id) {
    const comm = await Community.findById(user.default_community_id);
    if(comm === null)
      throw new Error("comm not found");
    state.community = comm;
    state.currencies = comm.currencies;
    if (comm.currencies.length === 1) {
      state.currency = comm.currencies[0];
    }
    // We verify if the user is not banned on this community
    if (await isBannedFromCommunity(user, user.default_community_id))
      return await messages.bannedUserErrorMessage(ctx, user);
  }

  await ctx.scene.enter(Scenes.CREATE_ORDER, state);
}

const isMaxPending = async (user: UserDocument) => {
  const pendingOrders = await Order.count({
    status: 'PENDING',
    creator_id: user._id,
  });
  const maxPendingOrders = process.env.MAX_PENDING_ORDERS;
  if(maxPendingOrders === undefined)
    throw new Error("Environment variable MAX_PENDING_ORDERS is not defined");
  // We don't let users create too PENDING many orders
  if (pendingOrders >= parseInt(maxPendingOrders)) {
    return true;
  }
  return false;
};

const takeOrder = async (ctx: MainContext) => {
  try {
    const validateParamsResult = await validateParams(ctx, 2, '\\<_order id_\\>');
    if(validateParamsResult === null || validateParamsResult.length === 0)
      throw new Error("validateParams failed");
    const [orderId] = validateParamsResult;
    const order = await Order.findOne({
      _id: orderId,
      status: 'PENDING',
    });
    if (!order) throw new Error('OrderNotFound');
    switch (order.type) {
      case 'buy': {
        let valid = false;
        await takebuyValidation(ctx, () => {
          valid = true;
        });
        if (!valid) return;
        return takebuy(ctx, ctx, orderId);
      }
      case 'sell': {
        return takesell(ctx, ctx, orderId);
      }
    }
  } catch (err: any) {
    switch (err.message) {
      case 'OrderNotFound':
        return ctx.reply(ctx.i18n.t('order_not_found'));
      default:
        return ctx.reply(ctx.i18n.t('generic_error'));
    }
  }
};

export { buyWizard, sellWizard, buy, sell, isMaxPending, takeOrder };
