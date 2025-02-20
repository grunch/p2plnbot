import { MainContext } from '../../start';
import { SceneContextScene, WizardContextWizard, WizardSessionData } from 'telegraf/typings/scenes';
import { Update, Message } from 'telegraf/typings/core/types/typegram';
import { Scenes, Telegraf } from 'telegraf';
import { ICommunity, IOrderChannel, IUsernameId } from '../../../models/community';
import { IOrder } from '../../../models/order';
import { UserDocument } from '../../../models/user';

export interface CommunityContext extends MainContext {
  scene: SceneContextScene<CommunityContext, WizardSessionData>;
  wizard: CommunityWizard;
  message: (Update.New & Update.NonChannel & Message.TextMessage) | undefined;
}

// This type is catch-all for any wizard state and probably should be split into several
// more specialized types.
export interface CommunityWizardState {
  name: string;
  currency: string;
  currencies: string[];
  group: any;
  channels: IOrderChannel[];
  fee: number;
  sats: number;
  fiatAmount: number[];
  priceMargin: number;
  solvers: IUsernameId[];
  disputeChannel: any;
  user: any;
  statusMessage: any;
  currentStatusText: string;
  community: ICommunity;
  order: IOrder;
  buyer: UserDocument;
  seller: UserDocument;
  type: string;
  method: string;
  bot: CommunityContext;
  message: Message.TextMessage | undefined;
  error?: any;
  feedback?: any;
  language: string;
  updateUI: (() => Promise<void>);
  handler?: ((ctx: CommunityContext) => Promise<any>);
}

export interface CommunityWizard extends WizardContextWizard<CommunityContext> {
  state: CommunityWizardState;
  bot: Telegraf<CommunityContext>;
}
