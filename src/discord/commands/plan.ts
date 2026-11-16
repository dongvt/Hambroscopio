import type { DiscordGateway } from "../../clients/discord/DiscordGateway.js";
import type { WeeklyPlanDeps } from "../../flows/weeklyPlan.js";
import { runWeeklyPlan } from "../../flows/weeklyPlan.js";
import { currentCorrelationId, withCorrelation } from "../../lib/context.js";
import { AppError, funErrorMessage } from "../../lib/errors.js";

export function registerPlanCommand(
  discord: DiscordGateway,
  deps: WeeklyPlanDeps,
  allowedUserIds: string[],
): void {
  discord.onSlashCommand("plan", async (invocation) => {
    await withCorrelation(async () => {
      if (!allowedUserIds.includes(invocation.userId)) {
        await invocation.reply("You are not allowed to run /plan.");
        return;
      }

      await invocation.defer();
      try {
        const result = await runWeeklyPlan(deps, {
          weekId: typeof invocation.options.week === "string" ? invocation.options.week : undefined,
        });
        await invocation.reply(
          result.status === "skipped"
            ? `Week ${result.weekId} is already complete; nothing was changed.`
            : `Week ${result.weekId} was planned and posted.`,
        );
      } catch (error) {
        deps.logger.error({ err: error }, "plan command failed");
        await invocation.reply(
          error instanceof AppError && error.code === "planning_failed"
            ? error.message
            : funErrorMessage(currentCorrelationId() ?? "unknown"),
        );
      }
    });
  });
}
