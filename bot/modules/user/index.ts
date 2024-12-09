// @ts-check
import { userMiddleware } from '../../middleware/user';

import { Telegraf } from 'telegraf';
import Scenes from './scenes';
import { CommunityContext } from '../community/communityContext';

export const configure = (bot: Telegraf<CommunityContext>) => {
  bot.command('/settings', userMiddleware, async ctx => {
    try {
      const { user } = ctx;
      await ctx.scene.enter(Scenes.Settings.id, { user });
    } catch (err: any) {
      ctx.reply(err.message);
    }
  });
};

export {
  Scenes
}
