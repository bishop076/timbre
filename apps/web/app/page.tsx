import { HomeView } from "./home-view";

export default function Home() {
  return (
    <div className="@container mx-auto w-full max-w-6xl px-5 pb-16 pt-5 sm:px-7 sm:pb-20">
      <h1 className="sr-only">Home — what’s playing now</h1>
      <HomeView />
    </div>
  );
}
