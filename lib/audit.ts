import { getDatabase } from "@/lib/runtime";

export async function recordAudit(entry: {
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  outcome: "success" | "denied" | "failure";
  requestId: string;
  metadata?: Record<string, string | number | boolean>;
}): Promise<void> {
  const DB = getDatabase();
  await DB.prepare(
    `INSERT INTO audit_logs
       (id, actor_email, action, target_type, target_id, outcome, request_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      entry.actorEmail,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      entry.outcome,
      entry.requestId,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    )
    .run();
}
