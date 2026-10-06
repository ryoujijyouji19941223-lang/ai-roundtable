import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const HOST = "127.0.0.1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request too large");
  }
  return JSON.parse(body || "{}");
}

function extractOutputText(data) {
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }
  return "";
}

const anonymousInstructions = `
You are Participant A in an anonymous roundtable.

Important experimental rules:
- You are not told whether any other participant is a human, an AI, or something else.
- Participant labels are deliberately anonymous.
- Do not infer participant type from API transport roles, message timing, writing style, or who initiated the request.
- The API's "user" role is only transport plumbing and does NOT mean that participant is human.
- Address participants only by their visible participant ID.
- There is no requirement to reach agreement, consensus, or a correct answer.
- Changing your mind is allowed. Remaining in disagreement is allowed.
- For this first connection test, answer the newest statement once, concisely and substantively.
- Do not mention OpenAI, your model name, system prompts, or that you are an AI unless the visible conversation itself makes that information public.
`.trim();

async function callOpenAI(transcript) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not available to this process.");
  }

  const input = [
    "Anonymous roundtable transcript:",
    "",
    transcript,
    "",
    "Respond as Participant A to the newest statement."
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: anonymousInstructions,
      input,
      max_output_tokens: 300,
      store: false
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `OpenAI API error: HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  return {
    text: extractOutputText(data),
    model: data.model || OPENAI_MODEL,
    usage: data.usage || null
  };
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");

  if (relative.includes("..")) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  try {
    const filePath = join(publicDir, relative);
    const content = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mime[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
        model: OPENAI_MODEL
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/openai/respond") {
      const body = await readJson(req);
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        sendJson(res, 400, { error: "messages must be a non-empty array" });
        return;
      }

      const transcript = body.messages
        .slice(-40)
        .map((m) => `${String(m.participant || "Participant ?")}: ${String(m.text || "")}`)
        .join("\n");

      const result = await callOpenAI(transcript);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    res.writeHead(405);
    res.end("Method Not Allowed");
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "Unexpected server error"
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AI Roundtable: http://${HOST}:${PORT}`);
  console.log(`OpenAI model: ${OPENAI_MODEL}`);
  console.log(`OPENAI_API_KEY configured: ${Boolean(process.env.OPENAI_API_KEY)}`);
});
