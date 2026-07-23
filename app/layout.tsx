import type { Metadata } from "next";
import "./globals.css";
import "./delete-book.css";
import "./edit-book.css";
import "./mobile-pdf-reader.css";
import "./pdf-tools.css";
import "./background-music.css";
import "./operations-dashboard.css";
import { BackgroundMusic } from "./background-music";
import { ServiceWorkerRegistration } from "./service-worker-registration";

export const metadata: Metadata = {
  title: "Tủ sách của Tuấn",
  description: "Thư viện của Tuấn — kho sách cá nhân để bạn bè đọc trực tuyến.",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/pwa-icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tủ sách của Tuấn",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>
        {children}
        <BackgroundMusic />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
