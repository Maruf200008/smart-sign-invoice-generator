import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import backgroundPattern from "@/assets/background_pattern.jpg";
import { ShareStatusCard } from "@/components/share/ShareStatusCard";
import { SharedInvoicePaper } from "@/components/share/SharedInvoicePaper";
import { SharedInvoiceToolbar } from "@/components/share/SharedInvoiceToolbar";
import { sharedToInvoiceDocument } from "@/lib/invoice-document";
import { resolvePublicShare } from "@/lib/share-server";

// Always render per request so disabling or expiring a link takes effect immediately.
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

// generateMetadata and the page both need the result; cache() makes that one database round trip per request.
const getShare = cache(resolvePublicShare);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const result = await getShare(token);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");

  // Invoices are private documents: previews get a title only (no customer name or amounts), and crawlers are kept out.
  const base: Metadata = {
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
    ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {})
  };

  if (result.status !== "ok") {
    return { ...base, title: "Invoice unavailable | Smart Sign" };
  }

  const title = `Invoice ${result.invoice.customer.invoiceNumber} | Smart Sign`;
  const description = "View this invoice from Smart Sign.";

  return {
    ...base,
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Smart Sign Invoice" },
    twitter: { card: "summary", title, description }
  };
}

export default async function SharedInvoicePage({ params }: PageProps) {
  const { token } = await params;
  const result = await getShare(token);

  if (result.status === "not-found") {
    notFound();
  }

  if (result.status !== "ok") {
    return <ShareStatusCard kind={result.status} />;
  }

  // Formatted on the server: the page, the PDF and the editor all show these exact strings.
  const document = sharedToInvoiceDocument(result.invoice);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#e8e8e8] text-zinc-950 sysdark:bg-zinc-950">
      <div
        aria-hidden="true"
        className="no-print pointer-events-none fixed inset-0 bg-cover bg-center bg-no-repeat opacity-50 sysdark:opacity-10"
        style={{ backgroundImage: `url(${backgroundPattern.src})` }}
      />

      <div className="relative z-10 mx-auto flex w-full flex-col items-center gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-7">
        <SharedInvoiceToolbar document={document} />

        <section className="w-full pb-8">
          <SharedInvoicePaper document={document} />
        </section>
      </div>
    </main>
  );
}
