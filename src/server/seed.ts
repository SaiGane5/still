import { withUserLock } from "./db";

export const DEMO_TASKS = [
  { title: "Finish the landing page", description: "Polish the hero section and responsive states.", minutes: 25 },
  { title: "Review pull request", description: "", minutes: 15 },
  { title: "Reply to project updates", description: "", minutes: 10 },
  { title: "Plan tomorrow", description: "", minutes: 5 },
  { title: "Write the weekly summary", description: "Highlights, blockers, and next steps.", minutes: 20 },
];

/** Initial demo data for brand-new users (enabled with STILL_SEED_DEMO=1). Not used in production by default. */
export async function seedDemoTasks(userId: string) {
  await withUserLock(userId, async (c) => {
    const { rows } = await c.query("SELECT count(*)::int AS n FROM tasks WHERE user_id = $1", [userId]);
    if (rows[0].n > 0) return;
    for (const [i, t] of DEMO_TASKS.entries()) {
      const s = t.minutes * 60;
      await c.query(
        `INSERT INTO tasks (user_id, title, description, planned_seconds, remaining_seconds, position, timer_running)
         VALUES ($1,$2,$3,$4,$4,$5,$6)`,
        [userId, t.title, t.description, s, i, i === 0],
      );
    }
  });
}
