import { getViewer } from "@/lib/authz";
import {
  getStorageStats,
  listPublishedBooks,
  type LibraryBook,
  type StorageStats,
} from "@/lib/library-repository";
import { isOwnerAuthConfigured, isRuntimeConfigured } from "@/lib/runtime";
import { selectRandomQuote } from "@/lib/quotes";
import { LibraryDashboard } from "./library-dashboard";

export const dynamic = "force-dynamic";

const emptyStorage: StorageStats = {
  committedBytes: 0,
  reservedBytes: 0,
  hardLimitBytes: 9_000_000_000,
};

export default async function Home() {
  const viewer = await getViewer();
  let books: LibraryBook[] = [];
  let storage = emptyStorage;
  let serviceError = false;

  if (isRuntimeConfigured()) {
    try {
      [books, storage] = await Promise.all([
        listPublishedBooks(),
        getStorageStats(),
      ]);
    } catch {
      serviceError = true;
    }
  } else {
    serviceError = true;
  }

  return (
    <LibraryDashboard
      initialBooks={books}
      initialStorage={storage}
      ownerConfigured={isOwnerAuthConfigured()}
      quote={selectRandomQuote()}
      serviceError={serviceError}
      viewer={{
        displayName: viewer.displayName,
        email: viewer.email,
        isOwner: viewer.isOwner,
      }}
    />
  );
}
