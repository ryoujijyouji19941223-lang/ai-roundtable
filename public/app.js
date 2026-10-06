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

async function health() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    statusEl.textContent = data.openaiKeyConfigured ? "OpenAI 接続準備OK" : "APIキー未検出";
    statusEl.dataset.ok = data.openaiKeyConfigured ? "1" : "0";
    modelEl.textContent = `Model: ${data.model || "-"}`;
  } catch {
    statusEl.textContent = "サーバー確認失敗";
  }
}

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;

  messages.push({ participant: "Participant B", text });
  inputEl.value = "";
  render();

  sendEl.disabled = true;
  sendEl.textContent = "Participant A が考えています…";

  try {
    const res = await fetch("/api/openai/respond", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");

    messages.push({
      participant: "Participant A",
      text: data.text || "(返答テキストなし)"
    });
    render();

    const u = data.usage;
    usageEl.textContent = u
      ? `Token usage: input ${u.input_tokens ?? "?"} / output ${u.output_tokens ?? "?"} / total ${u.total_tokens ?? "?"}`
      : "Token usage: -";
    modelEl.textContent = `Model: ${data.model || "-"}`;
  } catch (error) {
    messages.push({
      participant: "SYSTEM",
      text: `接続エラー: ${error.message}`
    });
    render();
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
