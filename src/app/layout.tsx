import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "still. — one thing at a time",
  description: "A calm, focus-first todo app with a quiet notes workspace for every task.",
};

export const viewport: Viewport = { themeColor: "#F4F1EA", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
