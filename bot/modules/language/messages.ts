import { logger } from '../../../logger';
import { ILanguage } from '../../../util/languagesModel';
import { MainContext } from '../../start';

export const showFlagsMessage = async (ctx: MainContext, flags: ILanguage[], code: string) => {
  try {
    const buttons = [];
    while (flags.length > 0) {
      const lastTwo = flags.splice(-2);
      const lineBtn = lastTwo.map(c => {
        let text = `${c.name} ${c.emoji}`;
        text += c.code === code ? '✔️' : '';
        return {
          text,
          callback_data: `setLanguage_${c.code}`,
        };
      });
      buttons.push(lineBtn);
    }

    await ctx.reply(ctx.i18n.t('select_language'), {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  } catch (error) {
    logger.error(error);
  }
};
