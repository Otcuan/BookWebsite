import { cookies } from "next/headers";
import {
  OWNER_COOKIE_NAME,
  verifyOwnerSession,
} from "@/lib/owner-session";
import { getDatabase, OWNER_PRINCIPAL_EMAIL } from "@/lib/runtime";

export type Viewer = {
  displayName: string;
  email: string;
  isOwner: boolean;
};

const publicViewer: Viewer = {
  displayName: "Bạn đọc",
  email: "public@library.local",
  isOwner: false,
};

export async function getViewer(): Promise<Viewer> {
  const cookieStore = await cookies();
  const token = cookieStore.get(OWNER_COOKIE_NAME)?.value;
  if (!token) return publicViewer;
  try {
    if (!(await verifyOwnerSession(token))) return publicViewer;
  } catch {
    return publicViewer;
  }

  return {
    displayName: "Tuấn",
    email: OWNER_PRINCIPAL_EMAIL,
    isOwner: true,
  };
}

export async function ensureOwnerPrincipal(viewer: Viewer): Promise<void> {
  if (!viewer.isOwner) throw new Error("Owner authorization required.");
  const DB = getDatabase();
  await DB.prepare(
    `INSERT INTO principals (email, display_name, role, status)
     VALUES (?, ?, 'owner', 'active')
     ON CONFLICT(email) DO UPDATE SET
       display_name = excluded.display_name,
       role = 'owner',
       status = 'active',
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(viewer.email, viewer.displayName)
    .run();
}
