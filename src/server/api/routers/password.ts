import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
} from "~/server/api/trpc";

export const passwordRouter = createTRPCRouter({
  getPasswords: protectedProcedure
    .query(async ({ ctx }) => {
        const passwords = await ctx.prisma.password.findMany({
            where: {
                userId: ctx.session.user.id
            }
        })
        return passwords
    }),
});
