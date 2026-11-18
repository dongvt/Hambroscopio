import type { DiscordGateway } from "../../clients/discord/DiscordGateway.js";
import type { WeeklyPlanDeps } from "../../flows/weeklyPlan.js";
import { runWeeklyPlan } from "../../flows/weeklyPlan.js";
import { currentCorrelationId, withCorrelation } from "../../lib/context.js";
import { funErrorMessage } from "../../lib/errors.js";
import { PlanningFailed } from "../../planner/planner.js";

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
          error instanceof PlanningFailed
            ? formatPlanningFailure(error)
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
      .slice(0, 3)
      .map((issue) => `  - ${issue}`)
      .join("\n");
    const omitted = attempt.issues.length > 3 ? `\n  - …and ${attempt.issues.length - 3} more` : "";
    return `Attempt ${attempt.attempt} (${categoryText}):\n${issues}${omitted}`;
  });
  const details = attempts.join("\n");
  const suffix = "\nSee bot logs at LOG_LEVEL=debug for prompt and full model responses.";
  const message = `${error.message}\n\n${details}${suffix}`;
  return message.length <= 1950 ? message : `${message.slice(0, 1947)}...`;
}
