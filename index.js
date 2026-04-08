import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function parseTasksFromModelOutput(rawOutput) {
  if (typeof rawOutput !== "string") {
    return [];
  }

  const cleanedOutput = rawOutput.replace(/```json|```/gi, "").trim();

  try {
    const parsed = JSON.parse(cleanedOutput);
    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (Array.isArray(parsed?.tasks)) {
      return parsed.tasks;
    }
  } catch {
    const arrayMatch = cleanedOutput.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }
  }

  return [];
}

app.post("/generate-tasks", async (req, res) => {
  try {
    const { transcript } = req.body;

    if (!transcript || typeof transcript !== "string") {
      return res.status(400).json({ error: "Transcript is required" });
    }

    const prompt = `
You are a highly accurate project manager AI.

Extract ONLY actionable tasks from the meeting transcript.

Rules:
- Ignore small talk
- Each task must be clear and specific
- Assign owner if mentioned, otherwise "Unassigned"
- Add realistic deadline if mentioned, otherwise "Not specified"

Return STRICT JSON (no extra text):

[
  {
    "task": "string",
    "owner": "string",
    "deadline": "string",
    "priority": "High | Medium | Low"
  }
]

Transcript:
${transcript}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const output = response.choices[0].message.content ?? "";
    const parsedTasks = parseTasksFromModelOutput(output);

    if (parsedTasks.length === 0 && output.trim()) {
      console.error("JSON parse failed:", output);
    }

    res.json({ result: parsedTasks });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));
