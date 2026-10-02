import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Noto_Sans_Devanagari, Plus_Jakarta_Sans } from "next/font/google";

import { Providers } from "@/components/providers";

import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
// Marathi / Hindi names appear in contact lists: the Devanagari font is the fallback for those characters.
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-devanagari", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-stack", display: "swap" });

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Employee Calling";

export const metadata: Metadata = {
  title: { default: `${appName} Admin`, template: `%s - ${appName} Admin` },
  description: "Track every employee's calls, talk time and recordings, and manage employees, contacts and campaigns.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f0" },
    { media: "(prefers-color-scheme: dark)", color: "#080c0a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${jakarta.variable} ${devanagari.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
