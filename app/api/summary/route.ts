import { MODEL, HttpError, errorResponse, getClient } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 120;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string", description: "Markdown" },
  },
  required: ["title", "summary"],
  propertyOrdering: ["title", "summary"],
};

export async function POST(req: Request) {
  try {
    const { transcript } = (await req.json()) as { transcript?: string };
    if (!transcript?.trim()) throw new HttpError(400, "The transcript is empty.");

    const ai = getClient();
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a meeting assistant. Read the meeting transcript and return:

1. "title": a short, specific meeting title (3-6 words) in the transcript's main language.
2. "summary": Markdown in the transcript's main language, using "##" headings translated into that language:
   - Overview: 2-4 sentences on the purpose and outcome.
   - Key Points: bullets grouped by topic.
   - Decisions: what was agreed.
   - Action Items: bullets as "**Owner** — task (deadline if mentioned)".
   - Open Questions: unresolved issues.
   Leave out a section when there is nothing for it. Stay faithful to the transcript and never invent facts.
   Add a timestamp like [12:34] after important points so readers can jump to them.

<transcript>
${transcript}
</transcript>`,
            },
          ],
        },
      ],
      config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, temperature: 0.3 },
    });

    const data = JSON.parse(res.text || "{}") as { title?: string; summary?: string };
    return Response.json({ title: data.title?.trim() ?? "", summary: data.summary?.trim() ?? "" });
  } catch (err) {
    return errorResponse(err);
  }
}
