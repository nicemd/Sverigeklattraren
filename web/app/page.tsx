import type { Metadata } from "next";
import { getArea, getAreaSummaries } from "@/lib/content";
import { GuideApp } from "./components/GuideApp";

export const metadata: Metadata = {
  title: "Sverigeföraren — klättring i Sverige",
  description: "Öppen, källspårbar klätterförare för svenska klippor och boulderområden.",
};

// Publicerade Git-ändringar ska synas utan ett nytt containerbygge.
export const dynamic = "force-dynamic";

export default async function Home() {
  const areas = await getAreaSummaries();
  const preferred = areas.find((area) => area.name.toLowerCase() === "utby")
    || areas.find((area) => area.coordinates && area.routeCount > 20)
    || areas[0];
  const initialArea = preferred ? await getArea(preferred.slug) : null;
  return <GuideApp areas={areas} initialArea={initialArea} />;
}
