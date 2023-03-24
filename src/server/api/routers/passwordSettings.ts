import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
} from "~/server/api/trpc";

export const passwordSettingsRouter = createTRPCRouter({
    getPasswordSettings: protectedProcedure
    .query(async ({ctx}) => {
        const settings = await ctx.prisma.passwordSettings.findFirst({
            where: {
                userId: ctx.session.user.id
            }
        })
        return settings
    }),
    updatePasswordSettings: protectedProcedure
        .input(z.object({
            passwordLength: z.number().min(8).max(64),
            passwordSymbols: z.boolean(),
            passwordNumbers: z.boolean(),
            passwordUppercase: z.boolean(),
            passwordLowercase: z.boolean(),
        }))
        .mutation(async ({ctx, input}) => {
            const settings = await ctx.prisma.passwordSettings.findUnique({
                where: {
                    userId: ctx.session.user.id
                }
            })

            if(settings == null){
                const newSettings = await ctx.prisma.passwordSettings.create({
                    data: {
                        user: {
                            connect: {
                                id: ctx.session.user.id
                            }
                        },
                        length: input.passwordLength,
                        symbols: input.passwordSymbols,
                        numbers: input.passwordNumbers,
                        uppercase: input.passwordUppercase,
                        lowercase: input.passwordLowercase,
                    }
                })

                return newSettings
            }else{
                const updatedSettings = await ctx.prisma.passwordSettings.update({
                    where: {
                        userId: ctx.session.user.id
                    },
                    data: {
                        length: input.passwordLength,
                        symbols: input.passwordSymbols,
                        numbers: input.passwordNumbers,
                        uppercase: input.passwordUppercase,
                        lowercase: input.passwordLowercase,
                    }
                })
                return updatedSettings
            }
        })
});
