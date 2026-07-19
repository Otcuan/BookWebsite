import { notFound } from "next/navigation";
import { getPublishedBook } from "@/lib/library-repository";
import { ReaderClient } from "./reader-client";

export const dynamic = "force-dynamic";

export default async function BookReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const book = await getPublishedBook(id);
  if (!book) notFound();

  return <ReaderClient book={book} />;
}
