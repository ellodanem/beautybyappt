import { app } from "./index.js";
import { initDB } from "./db.js";
import { processAppointmentReminders, type NotificationEnv } from "./notifications.js";

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: unknown, ctx: ExecutionContext) => {
    initDB(env);
    ctx.waitUntil(
      processAppointmentReminders(env as NotificationEnv).catch((err) =>
        console.error("[reminders] scheduled run failed:", err),
      ),
    );
  },
};
