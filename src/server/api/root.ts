import { createTRPCRouter } from "~/server/api/trpc";
import { passwordRouter } from "./routers/password";
import { passwordSettingsRouter } from "./routers/passwordSettings";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  password: passwordRouter,
  passwordSettings: passwordSettingsRouter
});

// export type definition of API
export type AppRouter = typeof appRouter;
