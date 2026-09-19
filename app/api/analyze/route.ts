import { GoogleGenAI } from "@google/genai";

export async function POST(request: Request) {
  const { imageBase64 } = await request.json();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return Response.json({ error: "Add GEMINI_API_KEY to .env.local before analyzing a room." }, { status: 503 });
  }
  if (typeof imageBase64 !== "string" || !imageBase64.startsWith("data:image/")) {
    return Response.json({ error: "Send a valid room image." }, { status: 400 });
  }

  const [header, data] = imageBase64.split(",", 2);
  const mimeType = header.match(/^data:(image\/[a-zA-Z+.-]+);base64$/)?.[1];
  if (!mimeType || !data) return Response.json({ error: "Image must be base64 encoded." }, { status: 400 });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{
        role: "user",
        parts: [
          { text: "Analyze this room for shopping recommendations. Return JSON only: {palette:string[3],styleTags:string[3],lighting:'warm'|'cool'|'neutral',searchTerms:string[5]}. Palette values must be hex colors; styleTags and searchTerms must be short lowercase phrases." },
          { inlineData: { mimeType, data } },
        ],
      }],
      config: { responseMimeType: "application/json" },
    });
    return Response.json(JSON.parse(response.text ?? ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Room analysis failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
