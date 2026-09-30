const Anthropic = require("@anthropic-ai/sdk");
const { config } = require("./config");

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const PROMPT = `You are an expert learning designer reviewing a class transcript.

Your job is to extract only two things from the transcript:

1. A very simple class summary
2. The exact homework assigned

Write for a non-technical audience at a 7th grade reading level. The reader should be able to quickly understand what happened in the class and what the student needs to do next.

Use this format:

## Class Summary

Write no more than 2 sentences. Explain only the main thing covered in the call. Do not include unnecessary detail, technical jargon, or long explanations.

## Homework

Extract the homework exactly from the transcript. Write each item as a clear bullet point.

Each bullet must follow this structure:

• Do [specific task] by [deadline].

Rules for homework:

• If the transcript gives a deadline, include that exact deadline.
• If no deadline is mentioned, write: "before the next class."
• Do not invent homework.
• Do not add extra tasks that were only discussed casually.
• Only include tasks the student was clearly asked to complete.
• If the homework is vague, make it clear but do not change the meaning.
• If no homework was assigned, write: "No homework was clearly assigned."

Respond ONLY as valid JSON with keys "summary" and "homework". No markdown, no extra text.

Transcript:
`;

async function summarizeTranscript(transcript) {
  const message = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 1000,
    messages: [{ role: "user", content: `${PROMPT}${transcript}` }]
  });

  const text = message.content
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("");

  try {
    const cleaned = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    return {
      summary: parsed.summary || null,
      homework: parsed.homework || null
    };
  } catch {
    return { summary: text, homework: null };
  }
}

module.exports = { summarizeTranscript };
