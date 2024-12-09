import { CommunityContext } from "../modules/community/communityContext";

import { validateUser, validateAdmin, validateSuperAdmin } from '../validations';

export const userMiddleware = async (ctx: CommunityContext, next: () => void) => {
  const user = await validateUser(ctx, false);
  if (!user) return false;
  ctx.i18n.locale(user.lang);
  ctx.user = user;

  next();
};

export const adminMiddleware = async (ctx: CommunityContext, next: () => void) => {
  const admin = await validateAdmin(ctx);
  if (!admin) return false;
  ctx.i18n.locale(admin.lang);
  ctx.admin = admin;

  next();
};

export const superAdminMiddleware = async (ctx: CommunityContext, next: () => void) => {
  const admin = await validateSuperAdmin(ctx);
  if (!admin) return false;
  ctx.i18n.locale(admin.lang);
  ctx.admin = admin;

  next();
};
