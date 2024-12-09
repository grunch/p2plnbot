import { Scenes } from 'telegraf';
import { CommunityContext } from './communityContext';

import * as CommunityEvents from '../events/community';

const communityAdmin = () => {
  const scene = new Scenes.WizardScene('COMMUNITY_ADMIN', async (ctx: CommunityContext) => {
    const { community } = ctx.scene.state as any;
    const str = ctx.i18n.t('community_admin', { community });
    await ctx.reply(str, { parse_mode: 'HTML' });
  });

  scene.command('/help', async ctx => {
    const str = ctx.i18n.t('community_admin_help');
    await ctx.reply(str, { parse_mode: 'HTML' });
  });

  scene.command('/setnpub', async (ctx: CommunityContext) => {
    try {
      const NostrLib = require('../nostr/lib');
      const [, npub] = ctx.message!.text.trim().split(' ');
      const hex = NostrLib.decodeNpub(npub);
      if (!hex) throw new Error('NpubNotValid');
      const { community } = ctx.scene.state as any;
      community.nostr_public_key = hex;
      await community.save();
      await ctx.reply(ctx.i18n.t('community_npub_updated', { npub }));
      CommunityEvents.communityUpdated(community);
    } catch (err) {
      return ctx.reply(ctx.i18n.t('npub_not_valid'), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      } as any);
    }
  });

  return scene;
}

export { communityAdmin };
