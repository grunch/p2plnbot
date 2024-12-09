import { Scenes } from 'telegraf';
import { logger } from '../../../logger';
import { Community, User, PendingPayment } from '../../../models';
import { IOrderChannel, IUsernameId } from '../../../models/community';
import { isGroupAdmin, itemsFromMessage, removeAtSymbol } from '../../../util';
import * as messages from '../../messages';
import { isValidInvoice } from '../../validations';
import { createCommunityWizardStatus, wizardCommunityWrongPermission } from './messages';
import { CommunityContext } from './communityContext';
import * as commAdmin from './scenes.communityAdmin';

const { isPendingPayment } = require('../../../ln');

const CURRENCIES = parseInt(process.env.COMMUNITY_CURRENCIES || '10');

export const communityAdmin = commAdmin.communityAdmin();

export const communityWizard = new Scenes.WizardScene<CommunityContext>(
  'COMMUNITY_WIZARD_SCENE_ID',
  async (ctx: CommunityContext) => {
    try {
      if (ctx.message === undefined) return ctx.scene.leave();

      const {
        name,
        currencies,
        group,
        channels,
        fee,
        solvers,
        disputeChannel,
        user,
        statusMessage,
      } = ctx.wizard.state;

      if (!statusMessage) {
        const status = createCommunityWizardStatus(
          ctx.i18n,
          ctx.wizard.state
        );
        const res = await ctx.reply(status!.text);
        ctx.wizard.state.currentStatusText = status!.text;
        ctx.wizard.state.statusMessage = res;
        ctx.wizard.state.updateUI = async () => {
          try {
            const status = createCommunityWizardStatus(
              ctx.i18n,
              ctx.wizard.state
            );
            if (ctx.wizard.state.currentStatusText === status!.text) return;
            await ctx.telegram.editMessageText(
              res.chat.id,
              res.message_id,
              undefined,
              status!.text
            );
            ctx.wizard.state.currentStatusText = status!.text;
          } catch (err) {
            logger.error(err);
          }
        };
      }

      if (undefined === name) return createCommunitySteps.name(ctx);
      if (undefined === currencies) return createCommunitySteps.currencies(ctx);
      if (undefined === group) return createCommunitySteps.group(ctx);
      if (undefined === channels) return createCommunitySteps.channels(ctx);
      if (undefined === fee) return createCommunitySteps.fee(ctx);
      if (undefined === solvers) return createCommunitySteps.solvers(ctx);
      if (undefined === disputeChannel)
        return createCommunitySteps.disputeChannel(ctx);

      const community = new Community({
        name,
        currencies,
        group,
        order_channels: channels,
        fee,
        solvers,
        dispute_channel: disputeChannel,
        creator_id: user._id,
      });
      await community.save();
      await ctx.reply(
        ctx.i18n.t('wizard_community_success', {
          days: process.env.COMMUNITY_TTL,
        })
      );

      return ctx.scene.leave();
    } catch (error: any) {
      const errString = error.toString();
      logger.error(error);
      ctx.scene.leave();
      if (errString.includes('duplicate key'))
        await ctx.reply(ctx.i18n.t('wizard_community_duplicated_name'));
    }
  },
  async ctx => {
    try {
      if (ctx.wizard.state.handler) {
        if (ctx.message === undefined) return ctx.scene.leave();
        const ret = await ctx.wizard.state.handler(ctx);
        if (!ret) return;
        delete ctx.wizard.state.handler;
      }
      ctx.wizard.selectStep(0);
      // use ['steps'] syntax as steps is private property and TypeScript would complain
      // eslint-disable-next-line dot-notation
      return ctx.wizard['steps'][ctx.wizard.cursor](ctx);
    } catch (err) {
      logger.error(err);
      return ctx.scene.leave();
    }
  }
);

const createCommunitySteps = {
  async name(ctx: CommunityContext) {
    const prompt = await createCommunityPrompts.name(ctx);

    ctx.wizard.state.handler = async (ctx: CommunityContext) => {
      const text = ctx?.message?.text;
      if (!text) {
        await ctx.deleteMessage();
        return ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
      }
      ctx.wizard.state.error = null;
      const name = text.trim();
      if (!name) {
        ctx.telegram.deleteMessage(ctx.chat!.id, ctx.message!.message_id);
        ctx.wizard.state.error = ctx.i18n.t('wizard_community_enter_name');
        return await ctx.wizard.state.updateUI();
      }
      const length = 30;
      if (name.length > length) {
        ctx.telegram.deleteMessage(ctx.chat!.id, ctx.message!.message_id);
        ctx.wizard.state.error = ctx.i18n.t(
          ctx.i18n.t('wizard_community_too_long_name', { length })
        );
        return await ctx.wizard.state.updateUI();
      }
      ctx.wizard.state.name = name;
      await ctx.wizard.state.updateUI();
      await ctx.telegram.deleteMessage(
        ctx.message!.chat.id,
        ctx.message!.message_id
      );
      return ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
    };

    return ctx.wizard.next();
  },
  async currencies(ctx: CommunityContext) {
    const prompt = await createCommunityPrompts.currencies(ctx);

    ctx.wizard.state.handler = async ctx => {
      const { text } = ctx.message!;
      if (!text) {
        await ctx.deleteMessage();
        return ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
      }
      ctx.wizard.state.error = null;
      let currencies = itemsFromMessage(text);
      currencies = currencies.map(currency => currency.toUpperCase());
      const max = CURRENCIES;
      if (currencies.length > max) {
        await ctx.telegram.deleteMessage(
          ctx.message!.chat.id,
          ctx.message!.message_id
        );
        ctx.wizard.state.error = ctx.i18n.t('max_allowed', { max });
        return await ctx.wizard.state.updateUI();
      }
      ctx.wizard.state.currencies = currencies;
      await ctx.wizard.state.updateUI();
      await ctx.telegram.deleteMessage(
        ctx.message!.chat.id,
        ctx.message!.message_id
      );
      return ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
    };

    return ctx.wizard.next();
  },
  async group(ctx: CommunityContext) {
    const prompt = await createCommunityPrompts.group(ctx);

    ctx.wizard.state.handler = async ctx => {
      try {
        const group = ctx.message?.text.trim();
        if (!group) {
          await ctx.deleteMessage();
          return ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
        }
        ctx.wizard.state.error = null;
        const { bot, user } = ctx.wizard.state;

        const isGroupOk = await isGroupAdmin(group, user, bot.telegram);

        if (!isGroupOk.success) {
          await ctx.telegram.deleteMessage(
            ctx.message!.chat.id,
            ctx.message!.message_id
          );
          await wizardCommunityWrongPermission(ctx, group, isGroupOk.message);

          return await ctx.wizard.state.updateUI();
        }

        ctx.wizard.state.group = group;
        await ctx.wizard.state.updateUI();
        await ctx.telegram.deleteMessage(
          ctx.message!.chat.id,
          ctx.message!.message_id
        );
        return ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
      } catch (error: any) {
        ctx.wizard.state.error = error.toString();
        return await ctx.wizard.state.updateUI();
      }
    };

    return ctx.wizard.next();
  },
  async channels(ctx: CommunityContext) {
    ctx.wizard.state.handler = async ctx => {
      const text = ctx.message?.text;
      if (!text) {
        await ctx.deleteMessage();
        return ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
      }
      const { bot, user } = ctx.wizard.state;
      const chan = itemsFromMessage(text);
      // ctx.wizard.state.channels = chan; // ???
      if (chan.length > 2) {
        await ctx.telegram.deleteMessage(
          ctx.message!.chat.id,
          ctx.message!.message_id
        );
        ctx.wizard.state.error = ctx.i18n.t(
          'wizard_community_one_or_two_channels'
        );
        return await ctx.wizard.state.updateUI();
      }
      const orderChannels: IOrderChannel[] = [];
      if (chan.length === 1) {
        const isGroupOk = await isGroupAdmin(chan[0], user, bot.telegram);
        if (!isGroupOk.success) {
          await ctx.telegram.deleteMessage(
            ctx.message!.chat.id,
            ctx.message!.message_id
          );
          await wizardCommunityWrongPermission(ctx, chan[0], isGroupOk.message);

          return await ctx.wizard.state.updateUI();
        }
        const channel = {
          name: chan[0],
          type: 'mixed',
        } as IOrderChannel;
        orderChannels.push(channel);
      } else {
        let isGroupOk = await isGroupAdmin(chan[0], user, bot.telegram);
        if (!isGroupOk.success) {
          await ctx.telegram.deleteMessage(
            ctx.message!.chat.id,
            ctx.message!.message_id
          );
          await wizardCommunityWrongPermission(ctx, chan[0], isGroupOk.message);

          return await ctx.wizard.state.updateUI();
        }
        isGroupOk = await isGroupAdmin(chan[1], user, bot.telegram);
        if (!isGroupOk.success) {
          await ctx.telegram.deleteMessage(
            ctx.message!.chat.id,
            ctx.message!.message_id
          );
          await wizardCommunityWrongPermission(ctx, chan[1], isGroupOk.message);

          return await ctx.wizard.state.updateUI();
        }
        const channel1 = {
          name: chan[0],
          type: 'buy',
        } as IOrderChannel;
        const channel2 = {
          name: chan[1],
          type: 'sell',
        } as IOrderChannel;
        orderChannels.push(channel1);
        orderChannels.push(channel2);
      }
      ctx.wizard.state.channels = orderChannels;
      await ctx.wizard.state.updateUI();
      await ctx.telegram.deleteMessage(
        ctx.message!.chat.id,
        ctx.message!.message_id
      );
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    const prompt = await createCommunityPrompts.channels(ctx);
    return ctx.wizard.next();
  },
  async fee(ctx: CommunityContext) {
    ctx.wizard.state.handler = async ctx => {
      const text = ctx.message?.text;
      if (!text) {
        await ctx.deleteMessage();
        return ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
      }
      const num = Number(text);
      if (isNaN(num)) {
        await ctx.telegram.deleteMessage(
          ctx.message!.chat.id,
          ctx.message!.message_id
        );
        ctx.wizard.state.error = ctx.i18n.t('not_number');
        return await ctx.wizard.state.updateUI();
      }
      if (num < 0 || num > 100) {
        await ctx.telegram.deleteMessage(
          ctx.message!.chat.id,
          ctx.message!.message_id
        );
        ctx.wizard.state.error = ctx.i18n.t('wizard_community_wrong_percent');
        return await ctx.wizard.state.updateUI();
      }
      ctx.wizard.state.fee = num;
      await ctx.wizard.state.updateUI();
      await ctx.telegram.deleteMessage(
        ctx.message!.chat.id,
        ctx.message!.message_id
      );
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    const prompt = await createCommunityPrompts.fee(ctx);
    return ctx.wizard.next();
  },
  async solvers(ctx: CommunityContext) {
    ctx.wizard.state.handler = async ctx => {
      const text = ctx.message?.text;
      if (!text) {
        await ctx.deleteMessage();
        return ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
      }
      const solvers = [];
      const usernames = itemsFromMessage(text);
      if (usernames.length > 0 && usernames.length < 10) {
        for (let i = 0; i < usernames.length; i++) {
          const username = removeAtSymbol(usernames[i]);
          const user = await User.findOne({ username });
          if (user) {
            solvers.push({
              id: user._id,
              username: user.username,
            } as IUsernameId);
          }
        }
      } else {
        await ctx.telegram.deleteMessage(
          ctx.message!.chat.id,
          ctx.message!.message_id
        );
        ctx.wizard.state.error = ctx.i18n.t(
          'wizard_community_must_enter_names'
        );
        return await ctx.wizard.state.updateUI();
      }
      ctx.wizard.state.solvers = solvers;

      await ctx.wizard.state.updateUI();
      await ctx.telegram.deleteMessage(
        ctx.message!.chat.id,
        ctx.message!.message_id
      );
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    const prompt = await createCommunityPrompts.solvers(ctx);
    return ctx.wizard.next();
  },
  async disputeChannel(ctx: CommunityContext) {
    ctx.wizard.state.handler = async ctx => {
      const channel = ctx.message!.text.trim();
      if (!channel) {
        await ctx.deleteMessage();
        return ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
      }
      const { bot, user } = ctx.wizard.state;

      const isGroupOk = await isGroupAdmin(channel, user, bot.telegram);
      if (!isGroupOk.success) {
        await ctx.telegram.deleteMessage(
          ctx.message!.chat.id,
          ctx.message!.message_id
        );
        await wizardCommunityWrongPermission(ctx, channel, isGroupOk.message);

        return await ctx.wizard.state.updateUI();
      }
      ctx.wizard.state.disputeChannel = channel;
      await ctx.wizard.state.updateUI();
      await ctx.telegram.deleteMessage(
        ctx.message!.chat.id,
        ctx.message!.message_id
      );
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    const prompt = await createCommunityPrompts.disputeChannel(ctx);
    return ctx.wizard.next();
  },
};

const createCommunityPrompts = {
  async name(ctx: CommunityContext) {
    return ctx.reply(ctx.i18n.t('wizard_community_enter_name'));
  },
  async currencies(ctx: CommunityContext) {
    return ctx.reply(ctx.i18n.t('wizard_community_enter_currency'));
  },
  async group(ctx: CommunityContext) {
    return ctx.reply(ctx.i18n.t('wizard_community_enter_group'));
  },
  async channels(ctx: CommunityContext) {
    return ctx.reply(ctx.i18n.t('wizard_community_enter_order_channels'));
  },
  async fee(ctx: CommunityContext) {
    return ctx.reply(ctx.i18n.t('wizard_community_enter_fee_percent'));
  },
  async solvers(ctx: CommunityContext) {
    return ctx.reply(ctx.i18n.t('wizard_community_enter_solvers'));
  },
  async disputeChannel(ctx: CommunityContext) {
    return ctx.reply(ctx.i18n.t('wizard_community_enter_solvers_channel'));
  },
};

export const updateNameCommunityWizard = new Scenes.WizardScene(
  'UPDATE_NAME_COMMUNITY_WIZARD_SCENE_ID',
  async (ctx: CommunityContext) => {
    try {
      const { community } = ctx.wizard.state;
      let message = ctx.i18n.t('name') + ': ' + community.name + '\n\n';
      message += ctx.i18n.t('wizard_community_enter_name') + '\n\n';
      message += ctx.i18n.t('wizard_to_exit');
      await ctx.reply(message);

      return ctx.wizard.next();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  },
  async (ctx: CommunityContext) => {
    try {
      if (ctx.message === undefined) return ctx.scene.leave();

      const name = ctx.message.text.trim();
      const length = 30;
      if (name.length > length) {
        ctx.deleteMessage();
        return await ctx.reply(
          ctx.i18n.t('wizard_community_too_long_name', { length })
        );
      }
      const { community } = ctx.wizard.state;

      community.name = name;
      await community.save();
      await ctx.reply(ctx.i18n.t('operation_successful'));

      return ctx.scene.leave();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  }
);

export const updateGroupCommunityWizard = new Scenes.WizardScene(
  'UPDATE_GROUP_COMMUNITY_WIZARD_SCENE_ID',
  async (ctx: CommunityContext) => {
    try {
      const { community } = ctx.wizard.state;
      let message = ctx.i18n.t('group') + ': ' + community.group + '\n\n';
      message += ctx.i18n.t('wizard_community_enter_group') + '\n\n';
      message += ctx.i18n.t('wizard_to_exit');
      await ctx.reply(message);

      return ctx.wizard.next();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  },
  async ctx => {
    try {
      if (ctx.message === undefined) return ctx.scene.leave();

      const group = ctx.message.text.trim();
      const { community, bot, user } = ctx.wizard.state;
      const isGroupOk = await isGroupAdmin(group, user, bot.telegram);

      if (!isGroupOk.success) {
        return await wizardCommunityWrongPermission(
          ctx,
          group,
          isGroupOk.message
        );
      }

      community.group = group;
      await community.save();
      await ctx.reply(ctx.i18n.t('operation_successful'));

      return ctx.scene.leave();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  }
);

export const updateCurrenciesCommunityWizard = new Scenes.WizardScene(
  'UPDATE_CURRENCIES_COMMUNITY_WIZARD_SCENE_ID',
  async (ctx: CommunityContext) => {
    try {
      const { community } = ctx.wizard.state;
      const currencies = community.currencies.join(', ');
      let message = ctx.i18n.t('currency') + ': ' + currencies + '\n\n';
      message += ctx.i18n.t('wizard_community_enter_currency') + '\n\n';
      message += ctx.i18n.t('wizard_to_exit');
      await ctx.reply(message);

      return ctx.wizard.next();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  },
  async (ctx: CommunityContext) => {
    try {
      if (ctx.message === undefined) {
        return ctx.scene.leave();
      }

      let currencies = itemsFromMessage(ctx.message.text);
      currencies = currencies.map(currency => currency.toUpperCase());
      if (currencies.length > CURRENCIES)
        return await ctx.reply(ctx.i18n.t('wizard_community_enter_currency'));

      const { community } = ctx.wizard.state;

      community.currencies = currencies;
      await community.save();
      await ctx.reply(ctx.i18n.t('operation_successful'));

      return ctx.scene.leave();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  }
);

export const updateChannelsCommunityWizard = new Scenes.WizardScene(
  'UPDATE_CHANNELS_COMMUNITY_WIZARD_SCENE_ID',
  async (ctx: CommunityContext) => {
    try {
      const { community } = ctx.wizard.state;
      const channels = community.order_channels
        .map(channel => channel.name)
        .join(', ');
      let message = ctx.i18n.t('channels') + ': ' + channels + '\n\n';
      message += ctx.i18n.t('wizard_community_one_or_two_channels') + '\n\n';
      message += ctx.i18n.t('wizard_to_exit');
      await ctx.reply(message);

      return ctx.wizard.next();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  },
  async ctx => {
    try {
      if (ctx.message === undefined) return ctx.scene.leave();

      const chan = itemsFromMessage(ctx.message.text);
      if (chan.length > 2)
        await ctx.reply(ctx.i18n.t('wizard_community_one_or_two_channels'));

      const { community, bot, user } = ctx.wizard.state;

      const orderChannels: IOrderChannel[] = [];
      if (chan.length === 1) {
        const isGroupOk = await isGroupAdmin(chan[0], user, bot.telegram);

        if (!isGroupOk.success) {
          return await wizardCommunityWrongPermission(
            ctx,
            chan[0],
            isGroupOk.message
          );
        }

        const channel = {
          name: chan[0],
          type: 'mixed',
        } as IOrderChannel;
        orderChannels.push(channel);
      } else {
        let isGroupOk = await isGroupAdmin(chan[0], user, bot.telegram);

        if (!isGroupOk.success) {
          return await wizardCommunityWrongPermission(
            ctx,
            chan[0],
            isGroupOk.message
          );
        }

        isGroupOk = await isGroupAdmin(chan[1], user, bot.telegram);

        if (!isGroupOk.success) {
          return await wizardCommunityWrongPermission(
            ctx,
            chan[1],
            isGroupOk.message
          );
        }

        const channel1 = {
          name: chan[0],
          type: 'buy',
        } as IOrderChannel;
        const channel2 = {
          name: chan[1],
          type: 'sell',
        } as IOrderChannel;
        orderChannels.push(channel1);
        orderChannels.push(channel2);
      }
      orderChannels.forEach(chan => {
        if (chan.name[0] == '-') {
          community.public = false;
        }
      });

      community.order_channels = orderChannels as any;
      await community.save();
      await ctx.reply(ctx.i18n.t('operation_successful'));

      return ctx.scene.leave();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  }
);

export const updateSolversCommunityWizard = new Scenes.WizardScene(
  'UPDATE_SOLVERS_COMMUNITY_WIZARD_SCENE_ID',
  async (ctx: CommunityContext) => {
    try {
      const { community } = ctx.wizard.state;
      const solvers = community.solvers
        .map(solver => '@' + solver.username)
        .join(', ');
      let message = ctx.i18n.t('solvers') + ': ' + solvers + '\n\n';
      message += ctx.i18n.t('wizard_community_enter_solvers') + '\n\n';
      message += ctx.i18n.t('wizard_to_exit');
      await ctx.reply(message);

      return ctx.wizard.next();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  },
  async (ctx: CommunityContext) => {
    try {
      if (ctx.message === undefined) return ctx.scene.leave();

      const solvers: IUsernameId[] = [];
      const botUsers = [];
      const notBotUsers = [];
      const usernames = itemsFromMessage(ctx.message.text);

      if (usernames.length > 0 && usernames.length < 10) {
        for (let i = 0; i < usernames.length; i++) {
          const username = removeAtSymbol(usernames[i]);
          const user = await User.findOne({ username });
          if(user == null)
            throw new Error("user not found");
          if (user) {
            solvers.push({
              id: user._id,
              username: user.username,
            } as IUsernameId);
            botUsers.push(username);
          } else {
            notBotUsers.push(username);
          }
        }
      } else {
        await ctx.reply(ctx.i18n.t('wizard_community_must_enter_names'));
      }

      if (botUsers.length) {
        await ctx.reply(
          ctx.i18n.t('users_added', {
            users: botUsers.join(', '),
          })
        );
        const { community } = ctx.wizard.state;

        community.solvers = solvers as any;
        await community.save();
      }

      if (notBotUsers.length)
        await ctx.reply(
          ctx.i18n.t('users_not_added', { users: notBotUsers.join(', ') })
        );

      return ctx.scene.leave();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  }
);

export const updateFeeCommunityWizard = new Scenes.WizardScene(
  'UPDATE_FEE_COMMUNITY_WIZARD_SCENE_ID',
  async (ctx: CommunityContext) => {
    try {
      const { community } = ctx.wizard.state;
      let message = ctx.i18n.t('fee') + ': ' + community.fee + '\n\n';
      message += ctx.i18n.t('wizard_community_enter_fee_percent') + '\n\n';
      message += ctx.i18n.t('wizard_to_exit');
      await ctx.reply(message);

      return ctx.wizard.next();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  },
  async ctx => {
    try {
      if (ctx.message === undefined) {
        return ctx.scene.leave();
      }

      const fee = Number(ctx.message.text.trim());

      if (isNaN(fee)) {
        return await messages.mustBeANumber(ctx);
      }

      if (fee < 0 || fee > 100) {
        return await ctx.reply(ctx.i18n.t('wizard_community_wrong_percent'));
      }
      const { community } = ctx.wizard.state;

      community.fee = fee;
      await community.save();
      await ctx.reply(ctx.i18n.t('operation_successful'));

      return ctx.scene.leave();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  }
);

export const updateDisputeChannelCommunityWizard = new Scenes.WizardScene(
  'UPDATE_DISPUTE_CHANNEL_COMMUNITY_WIZARD_SCENE_ID',
  async (ctx: CommunityContext) => {
    try {
      const { community } = ctx.wizard.state;
      let message =
        ctx.i18n.t('dispute_channel') +
        ': ' +
        community.dispute_channel +
        '\n\n';
      message += ctx.i18n.t('wizard_community_enter_solvers_channel') + '\n\n';
      message += ctx.i18n.t('wizard_to_exit');
      await ctx.reply(message);

      return ctx.wizard.next();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  },
  async (ctx: CommunityContext) => {
    try {
      if (ctx.message === undefined) return ctx.scene.leave();

      const channel = ctx.message.text.trim();

      const { community, bot, user } = ctx.wizard.state;
      const isGroupOk = await isGroupAdmin(channel, user, bot.telegram);

      if (!isGroupOk.success) {
        return await wizardCommunityWrongPermission(
          ctx,
          channel,
          isGroupOk.message
        );
      }

      community.dispute_channel = channel;
      await community.save();
      await ctx.reply(ctx.i18n.t('operation_successful'));

      return ctx.scene.leave();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  }
);

export const addEarningsInvoiceWizard = new Scenes.WizardScene(
  'ADD_EARNINGS_INVOICE_WIZARD_SCENE_ID',
  async (ctx: CommunityContext) => {
    try {
      const { community } = ctx.wizard.state;
      if (community.earnings === 0) return ctx.scene.leave();

      await ctx.reply(
        ctx.i18n.t('send_me_lninvoice', { amount: community.earnings })
      );

      return ctx.wizard.next();
    } catch (error) {
      logger.error(error);
    }
  },
  async (ctx: CommunityContext) => {
    try {
      if (ctx.message === undefined) return ctx.scene.leave();
      const lnInvoice = ctx.message.text.trim();
      const { community } = ctx.wizard.state;

      const res = await isValidInvoice(ctx, lnInvoice);
      if (!res.success) return;

      if (!!res.invoice.tokens && res.invoice.tokens !== community.earnings)
        return await ctx.reply(ctx.i18n.t('invoice_with_incorrect_amount'));

      const isScheduled = await PendingPayment.findOne({
        community_id: community._id,
        attempts: { $lt: process.env.PAYMENT_ATTEMPTS },
        paid: false,
      });
      // We check if the payment is on flight
      const isPending = await isPendingPayment(lnInvoice);

      if (!!isScheduled || !!isPending)
        return await ctx.reply(ctx.i18n.t('invoice_already_being_paid'));

      const user = await User.findById(community.creator_id);
      if(user === null)
        throw new Error("user was not found");
      logger.debug(`Creating pending payment for community ${community.id}`);
      const pp = new PendingPayment({
        amount: community.earnings,
        payment_request: lnInvoice,
        user_id: user.id,
        community_id: community._id,
        description: `Retiro por admin @${user.username}`,
        hash: res.invoice.hash,
      });
      await pp.save();
      await ctx.reply(ctx.i18n.t('invoice_updated_and_will_be_paid'));

      return ctx.scene.leave();
    } catch (error) {
      logger.error(error);
      ctx.scene.leave();
    }
  }
);
