import "./globals.css";

export const metadata = {
  title: "LGU Queuing System",
  description: "Firebase priority queue system",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
