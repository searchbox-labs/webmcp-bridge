import type { Metadata } from "next";
import { DM_Mono, Special_Elite } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const dmMono = DM_Mono({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const specialElite = Special_Elite({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "WebMCP Bridge Demo — Pods On Mars",
  description: "Pair a local runtime and build an emotionally sequenced Spotify playlist through WebMCP.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${dmMono.variable} ${specialElite.variable}`}>{children}</body>
    </html>
  );
}
