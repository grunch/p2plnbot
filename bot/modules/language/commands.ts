import path from 'path';
import fs from 'fs';
import { getLanguageFlag } from '../../../util';
import { logger } from '../../../logger';
import { showFlagsMessage } from './messages';
import { ILanguage } from '../../../util/languagesModel';
import { MainContext } from '../../start';

export const setlang = async (ctx: MainContext) => {
  try {
    const flags: ILanguage[] = [];
    fs.readdirSync(path.join(__dirname, '../../../locales')).forEach(file => {
      const lang = file.split('.')[0];
      const flag = getLanguageFlag(lang);
      if (flag !== undefined) {
        flags.push(flag);
      }
    });
    await showFlagsMessage(ctx, flags, ctx.user.lang);
  } catch (error) {
    logger.error(error);
  }
};
