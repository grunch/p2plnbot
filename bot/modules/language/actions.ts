import { User } from '../../../models';
import { MainContext } from '../../start';

export const setLanguage = async (ctx: MainContext) => {
  const tgId = (ctx.update as any).callback_query.from.id;
  const user = await User.findOne({ tg_id: tgId });
  if (user === null) return;
  const code = ctx.match?.[1];
  if (code === undefined)
    throw new Error("setLanguage: code is undefined");
  ctx.deleteMessage();
  user.lang = code;
  ctx.i18n.locale(code);
  await user.save();
  await ctx.reply(ctx.i18n.t('operation_successful'));
};
