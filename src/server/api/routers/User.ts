import { z } from "zod";
import crypto from 'crypto';

import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
} from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";

export const userRouter = createTRPCRouter({
    getUser: protectedProcedure
        .query(async ({ctx}) => {
            if(ctx.session.user.id){
                const user = await ctx.prisma.user.findFirst({
                    where: {
                        id: ctx.session.user.id
                    }
                })

                return user;
            }else{
                return "No User"
            }
        }),
        updateSecret: protectedProcedure
            .mutation(async ({ctx}) => {
                try{
                    const randomData = Math.random().toString();
                const hash = crypto.createHash('md5').update(randomData).digest('hex')
                const secret = hash;

                const user = await ctx.prisma.user.update({
                    where: {
                        id: ctx.session.user.id
                    },
                    data: {
                        secret
                    }
                })

                return user
                }catch(err){
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        cause: err,
                        message: "Unexpected error occurred, please try again"
                    })
                }
            })
});
