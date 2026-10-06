const transcriptEl = document.querySelector("#transcript");
const inputEl = document.querySelector("#input");
const sendEl = document.querySelector("#send");
const statusEl = document.querySelector("#status");
const usageEl = document.querySelector("#usage");
const modelEl = document.querySelector("#model");

const messages = [];

function render() {
  transcriptEl.innerHTML = "";
  if (messages.length === 0) {
    transcriptEl.innerHTML = '<div class="empty">Participant B から何か話しかけてください。</div>';
    return;
  }

  for (const message of messages) {
    const article = document.createElement("article");
    article.className = "message";

    const who = document.createElement("div");
    who.className = "who";
    who.textContent = message.participant;

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = message.text;

    article.append(who, text);
    transcriptEl.append(article);
  }

  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function addSystemError(label, error) {
  messages.push({
    participant: "SYSTEM",
    text: `${label} 接続エラー: ${error.message}`
  });
  render();
}

async function health() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    const openai = data.openaiKeyConfigured ? "OpenAI OK" : "OpenAI 未検出";
    const gemini = data.geminiKeyConfigured ? "Gemini OK" : "Gemini 未検出";
    const claude = data.anthropicKeyConfigured ? "Claude OK" : "Claude 未検出";
    statusEl.textContent = `${openai} / ${gemini} / ${claude}`;
    statusEl.dataset.ok = data.openaiKeyConfigured && data.geminiKeyConfigured && data.anthropicKeyConfigured ? "1" : "0";
    modelEl.textContent = `Observer: A=${data.openaiModel || "-"} / C=${data.geminiModel || "-"} / D=${data.claudeModel || "-"}`;
  } catch {
    statusEl.textContent = "サーバー確認失敗";
  }
}

async function callParticipant(endpoint) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  messages.push({
    participant: data.participant,
    text: data.text || "(返答テキストなし)"
  });
  render();
  return data;
}

function usageText(openaiData, geminiData, claudeData) {
  const o = openaiData?.usage;
  const g = geminiData?.usage;
  const d = claudeData?.usage;
  const oText = o
    ? `A: in ${o.input_tokens ?? "?"} / out ${o.output_tokens ?? "?"}`
    : "A: -";
  const gText = g
    ? `C: in ${g.promptTokenCount ?? "?"} / out ${g.candidatesTokenCount ?? "?"}`
    : "C: -";
  const dText = d
    ? `D: in ${d.input_tokens ?? "?"} / out ${d.output_tokens ?? "?"}`
    : "D: -";
  return `Token usage — ${oText} | ${gText} | ${dText}`;
}

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;

  messages.push({ participant: "Participant B", text });
  inputEl.value = "";
  render();

  sendEl.disabled = true;
  let openaiData = null;
  let geminiData = null;
  let claudeData = null;

  try {
    sendEl.textContent = "Participant A が考えています…";
    try {
      openaiData = await callParticipant("/api/openai/respond");
    } catch (error) {
      addSystemError("Participant A", error);
    }

    sendEl.textContent = "Participant C が考えています…";
    try {
      geminiData = await callParticipant("/api/gemini/respond");
    } catch (error) {
      addSystemError("Participant C", error);
    }

    sendEl.textContent = "Participant D が考えています…";
    try {
      claudeData = await callParticipant("/api/anthropic/respond");
    } catch (error) {
      addSystemError("Participant D", error);
    }

    usageEl.textContent = usageText(openaiData, geminiData, claudeData);
  } finally {
    sendEl.disabled = false;
    sendEl.textContent = "Participant B として発言";
    inputEl.focus();
  }
}

sendEl.addEventListener("click", send);
inputEl.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") send();
});

health();
render();
