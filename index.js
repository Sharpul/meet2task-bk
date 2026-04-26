const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai").default;

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function summarizeTranscript(transcript) {
  const prompt = `
Summarize the following meeting transcript into key discussion points.
Ignore small talk.

Transcript:
${transcript}
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return res.choices[0].message.content ?? "";
}

async function extractTasksFromSummary(summary) {
  const prompt = `
You are a highly accurate project manager AI.

From the summary below, extract ALL actionable tasks.

IMPORTANT:
- Do NOT miss any task, even if it is low priority, planned for future, or in backlog
- Include tasks mentioned for next sprint or later
- Be exhaustive

Rules:
- Each task must be clear
- Assign owner if mentioned, else "Unassigned"
- Add deadline if mentioned, else "Not specified"
- Assign priority (High/Medium/Low)

Return STRICT JSON ONLY (no extra text):

[
  {
    "task": "string",
    "owner": "string",
    "deadline": "string",
    "priority": "High | Medium | Low"
  }
]

Summary:
${summary}
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return res.choices[0].message.content ?? "";
}

async function extractTasksFromTranscript(transcript) {
  const prompt = `
You are a highly accurate project manager AI.

From the meeting transcript below, extract ALL actionable tasks.

IMPORTANT:
- Do NOT miss any task
- Include backlog, future, and low priority tasks
- Be exhaustive

Return STRICT JSON ONLY:

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

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return res.choices[0].message.content ?? "";
}

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

function normalizeTask(task) {
  return task.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

async function dedupeTasks(tasks) {
  const prompt = `
You are an AI assistant.

You are given a list of tasks.

Some tasks may be duplicates or mean the same thing with different wording.

Your job:
- Merge duplicate or similar tasks into ONE
- Keep the best version (clear, complete)
- Preserve owner, deadline, priority correctly
- Do NOT lose any unique task

Return STRICT JSON:

[
  {
    "task": "string",
    "owner": "string",
    "deadline": "string",
    "priority": "High | Medium | Low"
  }
]

Tasks:
${JSON.stringify(tasks, null, 2)}
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return res.choices[0].message.content ?? "";
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

    const summary = await summarizeTranscript(transcript);

    const [tasksFromSummary, tasksFromTranscript] = await Promise.all([
      extractTasksFromSummary(summary),
      extractTasksFromTranscript(transcript)
    ]);

    const parsed1 = parseTasksFromModelOutput(tasksFromSummary);
    const parsed2 = parseTasksFromModelOutput(tasksFromTranscript);

    const mergedTasks = [...parsed1, ...parsed2];

    const uniqueMap = new Map();

    for (const t of mergedTasks) {
      const key = normalizeTask(t.task);

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, t);
      } else {
        // merge better data
        const existing = uniqueMap.get(key);

        uniqueMap.set(key, {
          task: t.task || existing.task,
          owner: existing.owner !== "Unassigned" ? existing.owner : t.owner,
          deadline: existing.deadline !== "Not specified" ? existing.deadline : t.deadline,
          priority: existing.priority || t.priority,
        });
      }
    }

    const uniqueTasks = Array.from(uniqueMap.values());

    const deduped = await dedupeTasks(uniqueTasks);
    const finalTasks = parseTasksFromModelOutput(deduped);

    if (finalTasks.length === 0) {
      console.error("JSON parse failed:", output);
    }

    res.json({ result: finalTasks });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));
