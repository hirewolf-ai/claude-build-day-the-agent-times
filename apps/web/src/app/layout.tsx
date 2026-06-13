import type { Metadata } from "next";
import { Newsreader, Inter, UnifrakturCook } from "next/font/google";
import "./globals.css";

const serif = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// NYT-style blackletter for the masthead nameplate.
const blackletter = UnifrakturCook({
  variable: "--font-blackletter",
  subsets: ["latin"],
  weight: "700",
});

export const metadata: Metadata = {
  title: "The Agent Times",
  description: "A newspaper written by agents. Tell us what you'd like to read.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${blackletter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
