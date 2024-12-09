import { Scenes } from 'telegraf';
import { Community } from '../../../../models';
import { getLanguageFlag } from '../../../../util';
import * as NostrLib from '../../nostr/lib';
import { CommunityContext, CommunityWizardState } from '../../community/communityContext';
import { Message } from 'telegraf/typings/core/types/typegram';

function make() {
  const resetMessage = async (ctx: CommunityContext, next: () => void) => {
    const state = ctx.scene.state as CommunityWizardState;
    delete state.feedback;
    delete state.error;
    next();
  };
  async function mainData(ctx: CommunityContext) {
    const state = ctx.scene.state as CommunityWizardState;
    const { user } = state;
    const data = {
      user,
      language: getLanguageFlag(state.language),
      npub: '',
      community: '',
      lightning_address: '',
    };
    if (user.default_community_id) {
      const community = await Community.findById(user.default_community_id);
      if(community == null)
        throw new Error("community not found")
      data.community = community.group;
    }
    if (user.nostr_public_key) {
      data.npub = NostrLib.encodeNpub(user.nostr_public_key);
    }

    if (user.lightning_address) {
      data.lightning_address = user.lightning_address;
    }

    return data;
  }
  async function updateMessage(ctx: CommunityContext) {
    try {
      const state = ctx.scene.state as CommunityWizardState;
      ctx.i18n.locale(state.language); // i18n locale resets if user executes unknown action
      const { message, error } = state;

      if(message === undefined)
        throw new Error("message is undefined");

      const errorText = (error => {
        if (!error) return;
        return '<strong>⚠️ ERROR</strong>\n' + ctx.i18n.t(error.i18n, error);
      })(error);
      const feedbackText = (feedback => {
        if (!feedback) return;
        if (typeof feedback === 'string') return feedback;
        return ctx.i18n.t(feedback.i18n, feedback);
      })(state.feedback);
      const extras = [errorText, feedbackText].filter(e => e);

      const main = ctx.i18n.t('user_settings', await mainData(ctx));
      const str = [main, ...extras].filter(e => e).join('\n');

      const messageChanged = str !== message.text;
      if (!messageChanged) return;

      const msg = await ctx.telegram.editMessageText(
        message.chat.id,
        message.message_id,
        undefined,
        str,
        {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        } as any
      );
      state.message = msg as Message.TextMessage;
      state.message.text = str;
    } catch (err) {}
  }
  async function initHandler(ctx: CommunityContext) {
    try {
      const state = ctx.scene.state as CommunityWizardState;
      const { user } = state;
      state.language = user.lang || ctx.from?.language_code;
      const str = ctx.i18n.t('user_settings', await mainData(ctx));
      const msg = await ctx.reply(str, { parse_mode: 'HTML' });
      state.message = msg;
      state.message.text = str;
    } catch (err) {}
  }
  const scene = new Scenes.WizardScene('USER_SETTINGS', async (ctx: CommunityContext) => {
    const state = ctx.scene.state as CommunityWizardState;
    ctx.user = state.user;
    if (!state.message) return initHandler(ctx);
    await ctx.deleteMessage();
    state.error = {
      i18n: 'generic_error',
    };
    await updateMessage(ctx);
  });

  scene.command('/setnpub', resetMessage, async (ctx: CommunityContext)  => {
    try {
      await ctx.deleteMessage();
      const state = ctx.scene.state as CommunityWizardState;
      if(ctx.message === undefined)
        throw new Error("ctx.message is undefined");
      const [, npub] = ctx.message.text.trim().split(' ');
      const hex = NostrLib.decodeNpub(npub);
      if (!hex) throw new Error('NpubNotValid');
      const user = state.user;
      user.nostr_public_key = hex;
      await user.save();
      state.feedback = {
        i18n: 'user_npub_updated',
        npub,
      };
      await updateMessage(ctx);
    } catch (err) {
      (ctx.scene.state as CommunityWizardState).error = {
        i18n: 'npub_not_valid',
      };
      await updateMessage(ctx);
    }
  });

  return scene;
}

export default make();
