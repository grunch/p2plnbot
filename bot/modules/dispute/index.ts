import * as commands from './commands';
import * as actions from './actions';
import { Telegraf } from 'telegraf';
import { userMiddleware, adminMiddleware } from '../../middleware/user';
import { CommunityContext } from '../community/communityContext';

export const configure = (bot: Telegraf<CommunityContext>) => {
  bot.command('dispute', userMiddleware, commands.dispute);
  bot.command('deldispute', adminMiddleware, commands.deleteDispute);
  bot.action(
    /^takeDispute_([0-9a-f]{24})$/,
    userMiddleware,
    actions.takeDispute
  );
};
