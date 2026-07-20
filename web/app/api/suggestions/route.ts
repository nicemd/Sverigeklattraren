import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getArea } from "@/lib/content";
import { runIntake } from "@/lib/agents/intake";
import { runEditor } from "@/lib/agents/editor";
import { runReviewer } from "@/lib/agents/reviewer";
import { publishProposal } from "@/lib/publish";

export const runtime = "nodejs";

const requestSchema = z.object({
  areaSlug: z.string().regex(/^[a-z0-9-]+$/),
  conversation: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) })).min(1).max(20),
  locale: z.enum(["sv", "en"]).default("sv"),
});

const attempts = new Map<string, number[]>();
function isRateLimited(request: Request) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const cutoff = Date.now() - 10 * 60 * 1000;
  const recent = (attempts.get(key) || []).filter((timestamp) => timestamp > cutoff);
  recent.push(Date.now());
  attempts.set(key, recent);
  return recent.length > 10;
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI API är inte konfigurerat." }, { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > 100_000) return NextResponse.json({ error: "Förslaget är för stort." }, { status: 413 });
  if (isRateLimited(request)) return NextResponse.json({ error: "För många försök. Vänta några minuter." }, { status: 429 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Förslaget har ogiltigt format." }, { status: 400 });
  const area = await getArea(parsed.data.areaSlug);
  if (!area) return NextResponse.json({ error: "Området hittades inte." }, { status: 404 });
  try {
    const locale = parsed.data.locale;
    const intake = await runIntake(area, parsed.data.conversation, locale);
    if (intake.status === "needs_information") return NextResponse.json({ reply: intake.reply, status: intake.status, questions: intake.missingQuestions });
    const receiptId = crypto.randomUUID();
    after(async () => {
      const startedAt = Date.now();
      try {
        const edit = await runEditor(area, intake, locale);
        const review = await runReviewer(area, intake, edit);
        const publication = await publishProposal(area, intake, edit, review);
        console.info("Suggestion processed", { receiptId, area: area.slug, durationMs: Date.now() - startedAt, publication });
      } catch (error) {
        console.error("Background suggestion processing failed", { receiptId, area: area.slug, durationMs: Date.now() - startedAt, error });
      }
    });
    const reply = locale === "en"
      ? "We have received your proposal. It is now being structured and quality-reviewed in the background. Proposals with sufficient quality, high confidence and verifiable sources may be approved automatically after the GitHub checks pass. Other proposals go to human review and do not change the published guide until approved. Access and safety changes always require human review. You can close this window."
      : "Vi har tagit emot ditt förslag. Det struktureras och kvalitetsgranskas nu i bakgrunden. Förslag med tillräcklig kvalitet, hög konfidens och kontrollerbara källor kan godkännas automatiskt efter godkända GitHub-kontroller. Övriga förslag går till mänsklig granskning och ändrar inte den publicerade föraren innan de har godkänts. Access- och säkerhetsändringar kräver alltid mänsklig granskning. Du kan stänga fönstret.";
    return NextResponse.json({ reply, status: "accepted", receiptId }, { status: 202 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Agentgranskningen misslyckades. Försök igen." }, { status: 502 });
  }
}
