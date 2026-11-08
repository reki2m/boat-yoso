import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "潮読み — ボートレース予想",
  description: "ボートレース日和の出走データから参考予想を作るアプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Shippori+Mincho:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
