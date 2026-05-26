import type { Metadata } from "next";
import { Inter, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const notoBengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  variable: "--font-noto-bengali",
});

export const metadata: Metadata = {
  title: "Smart Sign Invoice ",
  description:
    "Premium A4 invoice generator with live editing, PDF export, print layout, and Bangla support.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${notoBengali.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
