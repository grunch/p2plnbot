// @ts-check
import { Scenes } from 'telegraf';
import * as CommunityModule from '../modules/community';
import * as OrdersModule from '../modules/orders';
import * as UserModule from '../modules/user';
import { CommunityContext } from '../modules/community/communityContext';
import { addInvoiceWizard, addFiatAmountWizard, addInvoicePHIWizard } from '../scenes';

export const stageMiddleware = () => {
  const scenes = [
    addInvoiceWizard,
    addFiatAmountWizard,
    CommunityModule.Scenes.communityAdmin,
    CommunityModule.Scenes.communityWizard,
    CommunityModule.Scenes.updateNameCommunityWizard,
    CommunityModule.Scenes.updateGroupCommunityWizard,
    CommunityModule.Scenes.updateCurrenciesCommunityWizard,
    CommunityModule.Scenes.updateChannelsCommunityWizard,
    CommunityModule.Scenes.updateSolversCommunityWizard,
    CommunityModule.Scenes.updateFeeCommunityWizard,
    CommunityModule.Scenes.updateDisputeChannelCommunityWizard,
    CommunityModule.Scenes.addEarningsInvoiceWizard,
    addInvoicePHIWizard,
    OrdersModule.Scenes.createOrder,
    UserModule.Scenes.Settings,
  ];
  scenes.forEach(addGenericCommands);
  const stage = new Scenes.Stage(scenes, {
    ttl: 1200, // All wizards live 20 minutes
  });
  return stage.middleware();
};

function addGenericCommands(scene: Scenes.WizardScene<CommunityContext>) {
  scene.command('exit', async (ctx) => {
    await ctx.scene.leave();
    const text = ctx.i18n.t('wizard_exit');
    await ctx.reply(text);
  });
  scene.command('help', async ctx => {
    const text = ctx.i18n.t('wizard_help');
    await ctx.reply(text);
  });
  return scene;
}
