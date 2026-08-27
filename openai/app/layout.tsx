import type { Metadata } from "next";
import { DM_Mono, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const dmMono = DM_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: "Relay — OpenAI Realtime Assistant Studio",
  description:
    "Configure and test an OpenAI Realtime voice assistant with live transcription and Currai capture.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={[instrumentSerif.variable, dmMono.variable].join(" ")}
    >
      <body>{children}</body>
    </html>
  );
}
