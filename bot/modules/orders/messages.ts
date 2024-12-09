import { getOrderChannel, sanitizeMD, getTimeToExpirationOrder } from '../../../util';
import { logger } from '../../../logger';
import { IOrder } from '../../../models/order';
import { I18nContext } from '@grammyjs/i18n';
import { MainContext } from '../../start';
import { ExtraReplyMessage } from 'telegraf/typings/telegram-types';
import { CommunityWizardState } from '../community/communityContext';

export const listOrdersResponse = async (orders: IOrder[], i18n: I18nContext) => {
  const tasks = orders.map(async order => {
    const channel = await getOrderChannel(order);
    let amount = '\\-';
    const status = order.status.split('_').join('\\_');
    const fiatAmount =
      typeof order.fiat_amount !== 'undefined'
        ? sanitizeMD(order.fiat_amount)
        : [
            sanitizeMD(order.min_amount),
            ' \\- ',
            sanitizeMD(order.max_amount),
          ].join('');

    if (typeof order.amount !== 'undefined') amount = String(order.amount);
    const timeToExpire = getTimeToExpirationOrder(order, i18n);
    const details = [
      [''].join(''),
      ['`Id      `: ', '`', order.id, '`'].join(''),
      ['`Status  `: ', '`', status, '`'].join(''),
      ['`Sats amt`: ', '`', amount, '`'].join(''),
      ['`Fiat amt`: ', '`', fiatAmount, '`'].join(''),
      ['`Fiat    `: ', '`', order.fiat_code, '`'].join(''),
      ['`Channel `: ', '`', sanitizeMD(channel), '`'].join(''),
      ['`_________________________________`'].join(''),
    ];
    if (status === 'PENDING') {
      details.splice(3, 0, ['`Time rem`: ', '`', timeToExpire, '`'].join(''));
    }
    return details.join('\n');
  });
  const lines = await Promise.all(tasks);
  const body = lines.join('\n');
  return {
    text: body,
    extra: {
      parse_mode: 'MarkdownV2',
    } as ExtraReplyMessage,
  };
};

export const createOrderWizardStatus = (i18n: I18nContext, state: CommunityWizardState) => {
  const { type, priceMargin } = state;
  const action = type === 'sell' ? i18n.t('selling') : i18n.t('buying');
  const sats = state.sats ? state.sats + ' ' : '';
  const paymentAction =
    type === 'sell' ? i18n.t('receive_payment') : i18n.t('pay');
  const fiatAmount =
    undefined === state.fiatAmount ? '__' : state.fiatAmount.join('-');
  const currency = state.currency || '__';

  const text = [
    `${action} ${sats}${i18n.t('sats')}`,
    `${i18n.t('for')} ${fiatAmount} ${currency}.`,
    `${paymentAction} ${i18n.t('by')} ${state.method || '__'}`,
    priceMargin
      ? `${i18n.t('rate')}: ${process.env.FIAT_RATE_NAME} ${priceMargin}%`
      : ``,
    state.error && `Error: ${state.error}`,
    ` `,
    i18n.t('wizard_to_exit'),
  ]
    .filter(e => e)
    .join('\n');

  return { text };
};

export const deletedCommunityMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('community_deleted'));
  } catch (error) {
    logger.error(error);
  }
};
