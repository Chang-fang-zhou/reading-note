import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "读书笔记同步工具",
  description: "支持导入电子书、划线、批注、同步与导出"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
