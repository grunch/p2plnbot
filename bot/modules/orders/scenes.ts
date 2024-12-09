import { Scenes, Markup } from 'telegraf';
import { logger } from '../../../logger';
import { getCurrency } from '../../../util';
import * as ordersActions from '../../ordersActions';
import { publishBuyOrderMessage, publishSellOrderMessage } from '../../messages';
import * as messages from './messages';
import { CommunityContext } from '../community/communityContext';

export const CREATE_ORDER = 'CREATE_ORDER_WIZARD';

export const middleware = () => {
  const stage = new Scenes.Stage([createOrder]);
  return stage.middleware();
};

export const createOrder = new Scenes.WizardScene(
  CREATE_ORDER,
  async (ctx: CommunityContext) => {
    try {
      const {
        user,
        community,
        statusMessage,
        type,
        currency,
        fiatAmount,
        sats,
        priceMargin,
        method,
      } = ctx.wizard.state;
      if (!statusMessage) {
        const { text } = messages.createOrderWizardStatus(
          ctx.i18n,
          ctx.wizard.state
        );
        const res = await ctx.reply(text);
        ctx.wizard.state.currentStatusText = text;
        ctx.wizard.state.statusMessage = res;
        ctx.wizard.state.updateUI = async () => {
          try {
            const { text } = messages.createOrderWizardStatus(
              ctx.i18n,
              ctx.wizard.state
            );
            if (ctx.wizard.state.currentStatusText === text) return;
            await ctx.telegram.editMessageText(
              res.chat.id,
              res.message_id,
              undefined,
              text
            );
            ctx.wizard.state.currentStatusText = text;
          } catch (err) {
            logger.error(err);
          }
        };
      }
      if (undefined === currency) return createOrderSteps.currency(ctx);
      if (undefined === fiatAmount) return createOrderSteps.fiatAmount(ctx);
      if (undefined === sats) return createOrderSteps.sats(ctx);
      if (undefined === priceMargin && sats === 0)
        return createOrderSteps.priceMargin(ctx);
      if (undefined === method) return createOrderSteps.method(ctx);
      // We remove all special characters from the payment method
      const paymentMethod = method.replace(/[&/\\#,+~%.'":*?<>{}]/g, '');

      const order = await ordersActions.createOrder(ctx.i18n, ctx, user, {
        type,
        amount: sats,
        fiatAmount,
        fiatCode: currency,
        paymentMethod,
        status: 'PENDING',
        priceMargin,
        community_id: community && community.id,
      });
      if (order) {
        const publishFn =
          type === 'buy' ? publishBuyOrderMessage : publishSellOrderMessage;
        publishFn(ctx, user, order, ctx.i18n, true);
      }
      return ctx.scene.leave();
    } catch (err) {
      logger.error(err);
      return ctx.scene.leave();
    }
  },
  async ctx => {
    try {
      if (ctx.wizard.state.handler) {
        const ret = await ctx.wizard.state.handler(ctx);
        if (!ret) return;
        delete ctx.wizard.state.handler;
      }
      await ctx.wizard.selectStep(0);
      // use ["steps"] syntax as steps is private property
      // eslint-disable-next-line dot-notation
      return ctx.wizard["steps"][ctx.wizard.cursor](ctx);
    } catch (err) {
      logger.error(err);
      return ctx.scene.leave();
    }
  }
);

const createOrderSteps = {
  async currency(ctx: CommunityContext) {
    const prompt = await createOrderPrompts.currency(ctx);
    const deletePrompt = () =>
      ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
    ctx.wizard.state.handler = async ctx => {
      ctx.wizard.state.error = null;
      if (!ctx.wizard.state.currencies) {
        await ctx.deleteMessage();
        if (ctx.message === undefined) return ctx.scene.leave();
        const currency = getCurrency(ctx.message.text.toUpperCase());
        if (!currency) {
          ctx.wizard.state.error = ctx.i18n.t('invalid_currency');
          return await ctx.wizard.state.updateUI();
        }
        ctx.wizard.state.currency = currency.code;
        await ctx.wizard.state.updateUI();
      } else {
        if (!ctx.callbackQuery) return;
        const currency: string = (ctx.callbackQuery as any).data;
        ctx.wizard.state.currency = currency;
        await ctx.wizard.state.updateUI();
      }
      return deletePrompt();
    };
    return ctx.wizard.next();
  },
  async fiatAmount(ctx: CommunityContext) {
    ctx.wizard.state.handler = async ctx => {
      await createOrderHandlers.fiatAmount(ctx);
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    const prompt = await createOrderPrompts.fiatAmount(ctx);
    return ctx.wizard.next();
  },
  async method(ctx: CommunityContext) {
    ctx.wizard.state.handler = async ctx => {
      if (ctx.message === undefined) return ctx.scene.leave();
      const { text } = ctx.message;
      if (!text) return;
      ctx.wizard.state.method = text;
      await ctx.wizard.state.updateUI();
      await ctx.deleteMessage();
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    const prompt = await ctx.reply(ctx.i18n.t('enter_payment_method'));
    return ctx.wizard.next();
  },
  async priceMargin(ctx: CommunityContext) {
    const prompt = await createOrderPrompts.priceMargin(ctx);
    ctx.wizard.state.handler = async ctx => {
      ctx.wizard.state.error = null;
      if (!ctx.callbackQuery) {
        if (ctx.message === undefined) return ctx.scene.leave();
        const { text } = ctx.message;
        if (!text) return;
        const num = Number(text);
        await ctx.deleteMessage();
        if (isNaN(num)) {
          ctx.wizard.state.error = ctx.i18n.t('not_number');

          return await ctx.wizard.state.updateUI();
        }
        ctx.wizard.state.priceMargin = Math.floor(num);
        await ctx.wizard.state.updateUI();
      } else {
        ctx.wizard.state.priceMargin = parseInt((ctx.callbackQuery as any).data);
        await ctx.wizard.state.updateUI();
      }
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    return ctx.wizard.next();
  },
  async sats(ctx: CommunityContext) {
    const prompt = await createOrderPrompts.sats(ctx);
    ctx.wizard.state.handler = async ctx => {
      const ret = await createOrderHandlers.sats(ctx);
      if (!ret) return;
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    return ctx.wizard.next();
  },
};

const createOrderPrompts = {
  async priceMargin(ctx: CommunityContext) {
    const margin = ['-5', '-4', '-3', '-2', '-1', '+1', '+2', '+3', '+4', '+5'];
    const buttons = margin.map(m => Markup.button.callback(m + '%', m));
    const rows = [];
    const chunkSize = 5;
    for (let i = 0; i < buttons.length; i += chunkSize) {
      const chunk = buttons.slice(i, i + chunkSize);
      rows.push(chunk);
    }
    const noMargin = [
      {
        text: ctx.i18n.t('no_premium_or_discount'),
        callback_data: '0',
        hide: false,
      },
    ];
    rows.splice(1, 0, noMargin);
    return ctx.reply(
      ctx.i18n.t('enter_premium_discount'),
      Markup.inlineKeyboard(rows)
    );
  },
  async currency(ctx: CommunityContext) {
    const { currencies } = ctx.wizard.state;
    if (!currencies) return ctx.reply(ctx.i18n.t('enter_currency'));
    const buttons = currencies.map(currency =>
      Markup.button.callback(currency, currency)
    );
    const rows = [];
    const chunkSize = 3;
    for (let i = 0; i < buttons.length; i += chunkSize) {
      const chunk = buttons.slice(i, i + chunkSize);
      rows.push(chunk);
    }
    return ctx.reply(
      ctx.i18n.t('choose_currency'),
      Markup.inlineKeyboard(rows)
    );
  },
  async fiatAmount(ctx: CommunityContext) {
    const { currency } = ctx.wizard.state;
    return ctx.reply(ctx.i18n.t('enter_currency_amount', { currency }));
  },
  async sats(ctx: CommunityContext) {
    const button = Markup.button.callback(
      ctx.i18n.t('market_price'),
      'marketPrice'
    );
    return ctx.reply(
      ctx.i18n.t('enter_sats_amount'),
      Markup.inlineKeyboard([button])
    );
  },
};

const createOrderHandlers = {
  async fiatAmount(ctx: CommunityContext) {
    if (ctx.message === undefined) return ctx.scene.leave();
    ctx.wizard.state.error = null;
    await ctx.deleteMessage();
    const inputs = ctx.message.text.split('-').map(Number);
    // ranges like [100, 0, 2] (originate from ranges like 100--2)
    // will make this conditional fail
    if (inputs.length > 2) {
      ctx.wizard.state.error = ctx.i18n.t('must_be_number_or_range');
      await ctx.wizard.state.updateUI();
      return false;
    }

    if (inputs.length === 2 && inputs[1] <= inputs[0]) {
      ctx.wizard.state.error = ctx.i18n.t('must_be_number_or_range');
      await ctx.wizard.state.updateUI();
      return false;
    }
    const notNumbers = inputs.filter(isNaN);
    if (notNumbers.length) {
      ctx.wizard.state.error = ctx.i18n.t('not_number');
      await ctx.wizard.state.updateUI();
      return;
    }
    const zeros = inputs.filter(n => n === 0);
    if (zeros.length) {
      ctx.wizard.state.error = ctx.i18n.t('not_zero');
      await ctx.wizard.state.updateUI();
      return;
    }
    if (inputs.length > 1) ctx.wizard.state.sats = 0;

    ctx.wizard.state.fiatAmount = inputs;
    await ctx.wizard.state.updateUI();

    return true;
  },
  async sats(ctx: CommunityContext) {
    if (ctx.callbackQuery) {
      ctx.wizard.state.sats = 0;
      await ctx.wizard.state.updateUI();
      return true;
    }
    const input = Number(ctx.message?.text);
    await ctx.deleteMessage();
    if (isNaN(input)) {
      ctx.wizard.state.error = ctx.i18n.t('not_number');
      await ctx.wizard.state.updateUI();
      return;
    }
    if (input < 0) {
      ctx.wizard.state.error = ctx.i18n.t('not_negative');
      await ctx.wizard.state.updateUI();
      return;
    }
    ctx.wizard.state.sats = Math.floor(input);
    await ctx.wizard.state.updateUI();
    return true;
  },
};
