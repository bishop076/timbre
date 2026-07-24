import { SearchResults } from "./search-results";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center px-6 py-16">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Timbre</h1>
        <p className="mt-2 text-[var(--muted)]">
          One search across the music you don&rsquo;t have to pay for.
        </p>
      </header>

      <SearchResults />
    </main>
  );
}
