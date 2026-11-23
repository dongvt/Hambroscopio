import type { DiscordGateway } from "../../clients/discord/DiscordGateway.js";
import type { WeeklyPlanDeps } from "../../flows/weeklyPlan.js";
import { runWeeklyPlan } from "../../flows/weeklyPlan.js";
import { currentCorrelationId, withCorrelation } from "../../lib/context.js";
import { AppError, funErrorMessage } from "../../lib/errors.js";
import { PlanningFailed } from "../../planner/planner.js";

export function registerPlanCommand(
  discord: DiscordGateway,
  deps: WeeklyPlanDeps,
  allowedUserIds: string[],
): void {
  discord.onSlashCommand("plan", async (invocation) => {
    await withCorrelation(async () => {
      deps.logger.info({ userId: invocation.userId }, "plan command handler started");
      if (!allowedUserIds.includes(invocation.userId)) {
        await invocation.reply("You are not allowed to run /plan.");
        return;
      }

      try {
        await invocation.defer();
        deps.logger.info({ userId: invocation.userId }, "plan command acknowledged");
        await invocation.reply(
          "Planning the week now. If the first response has invalid JSON or validation issues, it will be retried automatically.",
        );
        const result = await runWeeklyPlan(deps, {
          weekId: typeof invocation.options.week === "string" ? invocation.options.week : undefined,
        });
        await invocation.reply(
          result.status === "skipped"
            ? `Week ${result.weekId} is already complete; nothing was changed.`
            : `Week ${result.weekId} was planned and posted.`,
        );
        deps.logger.info({ userId: invocation.userId }, "plan command completed");
      } catch (error) {
        deps.logger.error({ err: error }, "plan command failed");
        await invocation.reply(
          error instanceof PlanningFailed
            ? formatPlanningFailure(error)
            : error instanceof AppError
              ? `⚠️ ${error.message} (id: ${currentCorrelationId() ?? "unknown"})`
              : funErrorMessage(currentCorrelationId() ?? "unknown"),
        );
      }
    });
  });
}

function formatPlanningFailure(error: PlanningFailed): string {
  const attempts = error.attempts.map((attempt) => {
    const categoryText = attempt.issueCategories.join(", ") || "unknown";
    const issues = attempt.issues
      .slice(0, 2)
      .map((issue) => `  - ${issue}`)
      .join("\n");
    const omitted = attempt.issues.length > 2 ? `\n  - …and ${attempt.issues.length - 2} more` : "";
    const stopReason = attempt.stopReason ? `; stop=${attempt.stopReason}` : "";
    return `Attempt ${attempt.attempt} (${categoryText}${stopReason}):\n${issues}${omitted}`;
  });
  const details = attempts.join("\n");
  const suffix =
    "\nThe planner makes an initial attempt and up to two correction attempts. See LOG_LEVEL=debug logs for full diagnostics.";
  const message = `${error.message}\n\n${details}${suffix}`;
  return message.length <= 1950 ? message : `${message.slice(0, 1947)}...`;
}
