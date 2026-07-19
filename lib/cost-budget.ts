import { getDatabase } from "@/lib/runtime";

export const R2_CLASS_A_MONTHLY_APP_LIMIT = 5_000;
export const R2_CLASS_B_MONTHLY_APP_LIMIT = 100_000;

export async function consumeMonthlyBudget(input: {
  metric: "r2_class_a" | "r2_class_b";
  amount?: number;
  hardLimit: number;
}): Promise<boolean> {
  const DB = getDatabase();
  const period = new Date().toISOString().slice(0, 7);
  const amount = input.amount ?? 1;
  const row = await DB.prepare(
    `INSERT INTO cost_budgets (period, metric, count, hard_limit)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(period, metric) DO UPDATE SET
       count = cost_budgets.count + excluded.count,
       updated_at = CURRENT_TIMESTAMP
     WHERE cost_budgets.count + excluded.count <= cost_budgets.hard_limit
     RETURNING count`,
  )
    .bind(period, input.metric, amount, input.hardLimit)
    .first<{ count: number }>();
  return row !== null;
}
