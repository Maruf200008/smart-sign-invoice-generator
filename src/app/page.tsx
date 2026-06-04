"use client";

import { AuthGate } from "@/components/auth/AuthGate";
import { InvoiceDashboard } from "@/components/layout/InvoiceDashboard";

export default function Home() {
  return (
    <AuthGate>
      {(user, onSignOut) => <InvoiceDashboard currentUser={user} onSignOut={onSignOut} />}
    </AuthGate>
  );
}
