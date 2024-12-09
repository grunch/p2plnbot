// @ts-check
import { Telegraf } from 'telegraf';
import { userMiddleware } from '../../middleware/user';
import * as actions from './actions';
import * as commands from './commands';
import { earningsMessage, updateCommunityMessage, sureMessage } from './messages';
import { CommunityContext } from './communityContext';
import * as Scenes from './scenes';

export const configure = (bot: Telegraf<CommunityContext>) => {
  bot.command('mycomm', userMiddleware, commands.communityAdmin);
  bot.command('mycomms', userMiddleware, commands.myComms);
  bot.command('community', userMiddleware, async ctx => {
    const { user } = ctx;
    await ctx.scene.enter('COMMUNITY_WIZARD_SCENE_ID', { bot, user });
  });
  bot.command('setcomm', userMiddleware, commands.setComm);

  bot.action(
    /^updateCommunity_([0-9a-f]{24})$/,
    userMiddleware,
    updateCommunityMessage
  );
  bot.action(/^editNameBtn_([0-9a-f]{24})$/, userMiddleware, async ctx => {
    await commands.updateCommunity(ctx, ctx.match[1], 'name');
  });
  bot.action(/^editFeeBtn_([0-9a-f]{24})$/, userMiddleware, async ctx => {
    await commands.updateCommunity(ctx, ctx.match[1], 'fee');
  });
  bot.action(
    /^editCurrenciesBtn_([0-9a-f]{24})$/,
    userMiddleware,
    async ctx => {
      await commands.updateCommunity(ctx, ctx.match[1], 'currencies');
    }
  );
  bot.action(/^editGroupBtn_([0-9a-f]{24})$/, userMiddleware, async ctx => {
    await commands.updateCommunity(ctx, ctx.match[1], 'group', bot);
  });
  bot.action(/^editChannelsBtn_([0-9a-f]{24})$/, userMiddleware, async ctx => {
    await commands.updateCommunity(ctx, ctx.match[1], 'channels', bot);
  });
  bot.action(/^editSolversBtn_([0-9a-f]{24})$/, userMiddleware, async ctx => {
    await commands.updateCommunity(ctx, ctx.match[1], 'solvers', bot);
  });
  bot.action(
    /^editDisputeChannelBtn_([0-9a-f]{24})$/,
    userMiddleware,
    async ctx => {
      await commands.updateCommunity(ctx, ctx.match[1], 'disputeChannel', bot);
    }
  );

  bot.command('findcomms', userMiddleware, commands.findCommunity);
  bot.action(
    /^communityInfo_([0-9a-f]{24})$/,
    userMiddleware,
    actions.onCommunityInfo
  );
  bot.action(
    /^setCommunity_([0-9a-f]{24})$/,
    userMiddleware,
    actions.onSetCommunity
  );
  bot.action('doNothingBtn', userMiddleware, async ctx => {
    await ctx.deleteMessage();
  });
  bot.action(/^earningsBtn_([0-9a-f]{24})$/, userMiddleware, earningsMessage);
  bot.action(
    /^deleteCommunityAskBtn_([0-9a-f]{24})$/,
    userMiddleware,
    sureMessage
  );
  bot.action(
    /^withdrawEarnings_([0-9a-f]{24})$/,
    userMiddleware,
    actions.withdrawEarnings
  );
  bot.action(
    /^deleteCommunityBtn_([0-9a-f]{24})$/,
    userMiddleware,
    commands.deleteCommunity
  );
  bot.action(
    /^changeVisibilityBtn_([0-9a-f]{24})$/,
    userMiddleware,
    commands.changeVisibility
  );
};

export { Scenes };
