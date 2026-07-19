import type { Metadata } from "next";
import "./globals.css";
import "./delete-book.css";
import "./mobile-pdf-reader.css";

export const metadata: Metadata = {
  title: "Tủ sách của Tuấn",
  description: "Thư viện của Tuấn — kho sách cá nhân để bạn bè đọc trực tuyến.",
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
