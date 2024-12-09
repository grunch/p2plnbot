import { logger } from '../../../logger';
import { Community, PendingPayment } from '../../../models';
import { CommunityWizardState } from './communityContext';
import { ICommunity } from '../../../models/community';
import { I18nContext } from '@grammyjs/i18n';
import { MainContext } from '../../start';

export const createCommunityWizardStatus = (i18n: I18nContext, state: CommunityWizardState) => {
  try {
    let { name, group } = state;
    name = state.name || '__';
    let currencies = state.currencies && state.currencies.join(', ');
    currencies = currencies || '__';
    group = state.group || '__';
    let channels =
      state.channels && state.channels.map((channel: { name: string }) => channel.name).join(', ');
    channels = channels || '__';
    const fee = String(state.fee) || '__';
    let solvers =
      state.solvers && state.solvers.map(solver => solver.username).join(', ');
    solvers = solvers || '__';
    const text = [
      i18n.t('name') + `: ${name}`,
      i18n.t('currency') + `: ${currencies}`,
      i18n.t('group') + `: ${group}`,
      i18n.t('channels') + `: ${channels}`,
      i18n.t('fee') + `: ${fee}%`,
      i18n.t('dispute_solvers') + `: ${solvers}`,

      state.error && i18n.t('generic_error') + `: ${state.error}`,
      ``,
      i18n.t('wizard_to_exit'),
    ].join('\n');

    return { text };
  } catch (error) {
    logger.error(error);
  }
};

export const updateCommunityMessage = async (ctx: MainContext) => {
  try {
    await ctx.deleteMessage();
    const id = ctx.match?.[1];
    const community = await Community.findById(id);
    if(community == null)
      throw new Error("community was not found");
    let text = ctx.i18n.t('community') + `: ${community.name}\n`;
    text += ctx.i18n.t('what_to_do');
    const visibilityText = community.public
      ? '🕵️ ' + ctx.i18n.t('make_private')
      : '📢 ' + ctx.i18n.t('make_public');
    await ctx.reply(text, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '✏️ ' + ctx.i18n.t('name'),
              callback_data: `editNameBtn_${id}`,
            },
            {
              text: '✏️ ' + ctx.i18n.t('currencies'),
              callback_data: `editCurrenciesBtn_${id}`,
            },
          ],
          [
            {
              text: '✏️ ' + ctx.i18n.t('group'),
              callback_data: `editGroupBtn_${id}`,
            },
            {
              text: '✏️ ' + ctx.i18n.t('channels'),
              callback_data: `editChannelsBtn_${id}`,
            },
          ],
          [
            {
              text: '✏️ ' + ctx.i18n.t('fee'),
              callback_data: `editFeeBtn_${id}`,
            },
            {
              text: '✏️ ' + ctx.i18n.t('dispute_solvers'),
              callback_data: `editSolversBtn_${id}`,
            },
          ],
          [
            {
              text: '✏️ ' + ctx.i18n.t('dispute_channel'),
              callback_data: `editDisputeChannelBtn_${id}`,
            },
            {
              text: '💰 ' + ctx.i18n.t('earnings'),
              callback_data: `earningsBtn_${id}`,
            },
          ],
          [
            {
              text: visibilityText,
              callback_data: `changeVisibilityBtn_${id}`,
            },
            {
              text: '☠️ ' + ctx.i18n.t('delete_community'),
              callback_data: `deleteCommunityAskBtn_${id}`,
            },
          ],
        ],
      },
    });
  } catch (error) {
    logger.error(error);
  }
};

export const listCommunitiesMessage = async (ctx: MainContext, communities: ICommunity[]) => {
  try {
    let message = '';
    communities.forEach(community => {
      message += `ID: #${community.id}\n`;
      message += ctx.i18n.t('name') + `: ${community.name}\n`;
      message += ctx.i18n.t('group') + `: ${community.group}\n`;
      community.order_channels.forEach(channel => {
        message +=
          ctx.i18n.t('channel') + ` ${channel.type}: ${channel.name}\n`;
      });
      community.solvers.forEach(solver => {
        message += ctx.i18n.t('solver') + `: ${solver.username}\n`;
      });
      message +=
        ctx.i18n.t('published') +
        `: ${community.public ? ctx.i18n.t('yes') : ctx.i18n.t('no')}\n`;
      message += ctx.i18n.t('created') + `: ${community.created_at}\n\n`;
    });
    await ctx.reply(message);
  } catch (error) {
    logger.error(error);
  }
};

export const earningsMessage = async (ctx: MainContext) => {
  try {
    const communityId = ctx.match?.[1];
    // We check if there is a payment scheduled for this community
    const isScheduled = await PendingPayment.findOne({
      community_id: communityId,
      attempts: { $lt: process.env.PAYMENT_ATTEMPTS },
      paid: false,
    });
    if (isScheduled)
      return await ctx.reply(ctx.i18n.t('invoice_already_being_paid'));

    const community = await Community.findById(communityId);
    if(community == null)
      throw new Error("community was not found");
    const button =
      community.earnings > 0
        ? {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: ctx.i18n.t('withdraw_earnings'),
                    callback_data: `withdrawEarnings_${community._id}`,
                  },
                ],
              ],
            },
          }
        : undefined;
    await ctx.reply(
      ctx.i18n.t('current_earnings', {
        ordersToRedeem: community.orders_to_redeem,
        earnings: community.earnings,
      }),
      button
    );
  } catch (error) {
    logger.error(error);
  }
};

export const showUserCommunitiesMessage = async (ctx: MainContext, communities: ICommunity[]) => {
  try {
    const buttons = [];
    while (communities.length > 0) {
      const lastTwo = communities.splice(-2);
      const lineBtn = lastTwo.map(c => {
        return {
          text: c.name,
          callback_data: `updateCommunity_${c._id}`,
        };
      });
      buttons.push(lineBtn);
    }

    await ctx.reply(ctx.i18n.t('select_community'), {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  } catch (error) {
    logger.error(error);
  }
};

export const wizardCommunityWrongPermission = async (ctx: MainContext, channel: string, response: string) => {
  try {
    if (response.indexOf('bot was kicked from the supergroup chat') !== -1) {
      await ctx.reply(ctx.i18n.t('bot_kicked'));
    } else if (response.indexOf('chat not found') !== -1) {
      await ctx.reply(ctx.i18n.t('chat_not_found'));
    } else if (response.indexOf('not a member of this chat') !== -1) {
      await ctx.reply(ctx.i18n.t('not_member'));
    } else if (
      response.indexOf('group chat was upgraded to a supergroup') !== -1
    ) {
      await ctx.reply(ctx.i18n.t('upgraded_to_supergroup'));
    } else if (response.indexOf('is not an admin') !== -1) {
      await ctx.reply(
        ctx.i18n.t('wizard_community_you_are_not_admin', {
          channel,
        })
      );
    } else {
      await ctx.reply(ctx.i18n.t('generic_error'));
    }
  } catch (error) {
    logger.error(error);
  }
};

export const sureMessage = async (ctx: MainContext) => {
  try {
    await ctx.deleteMessage();
    const id = ctx.match?.[1];
    await ctx.reply(ctx.i18n.t('are_you_sure'), {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🔴 ' + ctx.i18n.t('no'),
              callback_data: `doNothingBtn`,
            },
            {
              text: '🟢 ' + ctx.i18n.t('yes'),
              callback_data: `deleteCommunityBtn_${id}`,
            },
          ],
        ],
      },
    });
  } catch (error) {
    logger.error(error);
  }
};
