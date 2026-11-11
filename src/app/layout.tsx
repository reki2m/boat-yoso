import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "潮読み — 本命・押し目・穴の3段予想",
  description:
    "得意コース・異常オッズ回避・イン戦起点の本命/押し目/穴買い目システム（検証ベース・保証なし）",
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
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;700&family=IBM+Plex+Sans+JP:wght@400;500;600;700&family=Oxanium:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
