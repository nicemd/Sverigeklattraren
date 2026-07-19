import type { Metadata } from "next";
import { getAreaSummaries } from "@/lib/content";
import { GuideApp } from "./components/GuideApp";

export const metadata: Metadata = {
  title: "Sverigeklättraren — klättring i Sverige",
  description: "Öppen, källspårbar klätterförare för svenska klippor och boulderområden.",
};

// Publicerade Git-ändringar ska synas utan ett nytt containerbygge.
export const dynamic = "force-dynamic";

export default async function Home() {
  const areas = (await getAreaSummaries()).map((area) => ({
    ...area,
    description: area.description.slice(0, 160),
    searchText: "",
    translations: undefined,
  }));
  return <GuideApp areas={areas} initialArea={null} />;
}
