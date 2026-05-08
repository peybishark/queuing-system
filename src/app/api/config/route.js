import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY || "",
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
      projectId: process.env.FIREBASE_PROJECT_ID || "",
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
      appId: process.env.FIREBASE_APP_ID || "",
    },
    orgName: process.env.QUEUE_ORG_NAME || "",
    superAdmin: {
      email: process.env.SUPERADMIN_EMAIL || "superadmin@local.test",
      password: process.env.SUPERADMIN_PASSWORD || "superadmin123",
    },
  });
}
