"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function OwnerLoginPage() {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: form.get("passphrase") }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Không thể đăng nhập.");
      router.replace("/");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể đăng nhập.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <Link href="/" className="reader-back">← Thư viện</Link>
        <p className="section-kicker">Khu vực riêng</p>
        <h1 id="login-title">Đăng nhập chủ kho</h1>
        <p>Bạn bè không cần đăng nhập để đọc. Mật khẩu này chỉ mở quyền tải sách.</p>
        <form onSubmit={submit}>
          <label>
            Mật khẩu chủ kho
            <input
              autoComplete="current-password"
              maxLength={256}
              name="passphrase"
              required
              type="password"
            />
          </label>
          {notice && <p className="notice" role="alert">{notice}</p>}
          <button className="upload-button" disabled={submitting} type="submit">
            {submitting ? "Đang xác minh…" : "Đăng nhập"}
          </button>
        </form>
      </section>
    </main>
  );
}
