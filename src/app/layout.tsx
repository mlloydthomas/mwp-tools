import type { Metadata } from "next";
import { Libre_Baskerville, DM_Mono, DM_Sans } from "next/font/google";
import "./globals.css";

const displayFont = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-display",
});

const bodyFont = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-body",
});

const monoFont = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "MWP Tools",
  description: "Milky Way Park · AI Operations Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}>
      <body className="bg-night-950 text-night-100 font-body antialiased">
        {children}
      </body>
    </html>
  );
}
