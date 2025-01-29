import { Context } from 'telegraf';

export interface CustomContext extends Context {
  user?: {
    id: string;
    tg_id: string;
  },
  i18n?: any;
}
