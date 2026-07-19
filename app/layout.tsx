import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tủ sách riêng",
  description: "Kho sách cá nhân để bạn bè đọc trực tuyến.",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
