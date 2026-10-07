const AI_IDS = ["Participant A", "Participant C", "Participant D"];
const HUMAN_ID = "Participant B";
const INITIAL_BUDGET = 12000;
const MAX_AI_CHAIN = 10;

const transcriptEl = document.querySelector("#transcript");
const inputEl = document.querySelector("#input");
const sendEl = document.querySelector("#send");
const takeFloorEl = document.querySelector("#takeFloor");
const resetEl = document.querySelector("#reset");
const statusEl = document.querySelector("#status");
const meetingStateEl = document.querySelector("#meetingState");
const observerLogEl = document.querySelector("#observerLog");

const messages = [];
const observerEntries = [];
const stats = Object.fromEntries(AI_IDS.map((id) => [id, {
  initial: INITIAL_BUDGET,
  remaining: INITIAL_BUDGET,
  decisionTokens: 0,
  speechTokens: 0,
  decisionUsdMin: 0,
  decisionUsdMax: 0,
  speechUsdMin: 0,
  speechUsdMax: 0,
  spoken: 0,
  passed: 0,
  raised: 0,
  lastDecision: null
}]));

let running = false;
let humanWantsFloor = false;
let fairIndex = 0;
let aiChain = 0;
let lastAiSpeaker = null;
let decisionRound = 0;
let pendingHands = [];

function shortId(id) {
  return id.replace("Participant ", "");
}

function addObserverLog(text) {
  observerEntries.unshift(new Date().toLocaleTimeString() + "  " + text);
  observerEntries.splice(80);
  observerLogEl.textContent = observerEntries.join("\n");
}

function renderTranscript() {
  transcriptEl.innerHTML = "";
  if (messages.length === 0) {
    transcriptEl.innerHTML = '<div class="empty">Participant B が最初の議題を話すところから開始します。</div>';
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

function formatUsd(value) {
  const n = Math.max(0, Number(value) || 0);
  if (n > 0 && n < 0.000001) return "<$0.000001";
  return "$" + n.toFixed(6);
}

function renderCostSummary() {
  let min = 0;
  let max = 0;
  for (const id of AI_IDS) {
    const s = stats[id];
    min += s.decisionUsdMin + s.speechUsdMin;
    max += s.decisionUsdMax + s.speechUsdMax;
  }
  const el = document.querySelector("#costSummary");
  if (!el) return;
  el.textContent = min === max
    ? "API標準単価換算 累計 " + formatUsd(max)
    : "API標準単価換算 累計 " + formatUsd(min) + " ～ " + formatUsd(max) + "（Gemini無料枠/有料枠）";
}

function renderStats() {
  for (const id of AI_IDS) {
    const s = stats[id];
    const key = shortId(id);
    const remaining = Math.max(0, Math.round(s.remaining));
    const pct = Math.max(0, Math.min(100, (remaining / s.initial) * 100));

    document.querySelector("#budget-" + key).textContent =
      remaining.toLocaleString() + " / " + s.initial.toLocaleString();

    document.querySelector("#bar-" + key).style.width = pct + "%";
    document.querySelector("#spent-" + key).textContent =
      "判断 " + Math.round(s.decisionTokens).toLocaleString() +
      " / 発言 " + Math.round(s.speechTokens).toLocaleString();

    document.querySelector("#count-" + key).textContent =
      "発言 " + s.spoken + "回 / 見送り " + s.passed + "回";

    const minUsd = s.decisionUsdMin + s.speechUsdMin;
    const maxUsd = s.decisionUsdMax + s.speechUsdMax;
    const costEl = document.querySelector("#cost-" + key);
    if (costEl) {
      costEl.textContent = minUsd === maxUsd
        ? "API推定 " + formatUsd(maxUsd)
        : "API推定 " + formatUsd(minUsd) + " ～ " + formatUsd(maxUsd);
    }
  }
  renderCostSummary();
}

function setParticipantState(id, label, kind = "") {
  const el = document.querySelector("#state-" + shortId(id));
  el.textContent = label;
  el.className = "participant-state " + kind;
}

function setHumanFloor(enabled, message) {
  running = !enabled;
  inputEl.disabled = !enabled;
  sendEl.disabled = !enabled;
  takeFloorEl.disabled = enabled;
  takeFloorEl.textContent = enabled ? "あなたが発言できます" : "発言する（AIを止める）";
  meetingStateEl.textContent = message;
  if (enabled) inputEl.focus();
}

function budgetFor(id) {
  return {
    initial: stats[id].initial,
    remaining: Math.max(0, stats[id].remaining)
  };
}

async function health() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    const all =
      data.openaiKeyConfigured &&
      data.geminiKeyConfigured &&
      data.anthropicKeyConfigured;

    statusEl.textContent = all ? "3 AI 接続OK" : "APIキーを確認";
    statusEl.dataset.ok = all ? "1" : "0";

    if (data.participants) {
      document.querySelector("#model-A").textContent = data.participants["Participant A"] || "-";
      document.querySelector("#model-C").textContent = data.participants["Participant C"] || "-";
      document.querySelector("#model-D").textContent = data.participants["Participant D"] || "-";
    }
  } catch {
    statusEl.textContent = "サーバー確認失敗";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(status, message) {
  const text = String(message || "").toLowerCase();
  return [429, 500, 502, 503, 504].includes(Number(status)) ||
    text.includes("high demand") ||
    text.includes("temporar") ||
    text.includes("try again later") ||
    text.includes("unavailable") ||
    text.includes("overloaded");
}

async function postParticipant(endpoint, payload, id, actionLabel, maxAttempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) return data;

      const error = new Error(data.error || actionLabel + " request failed");
      error.status = res.status;
      throw error;
    } catch (error) {
      lastError = error;

      if (!isTransientError(error.status, error.message) || attempt >= maxAttempts) {
        throw error;
      }

      const waitMs = attempt === 1 ? 1500 : 3500;
      setParticipantState(id, "一時混雑・再試行", "thinking");
      addObserverLog(
        id + " " + actionLabel + " 一時エラー: " + error.message +
        " / " + waitMs + "ms後に再試行 (" + attempt + "/" + maxAttempts + ")"
      );
      await sleep(waitMs);
    }
  }

  throw lastError || new Error(actionLabel + " request failed");
}

async function requestDecision(id) {
  setParticipantState(id, "判断中…", "thinking");

  const data = await postParticipant(
    "/api/participant/decide",
    {
      participant: id,
      messages,
      budget: budgetFor(id)
    },
    id,
    "判断"
  );

  const cost = Number(data.tokenCost) || 0;
  const apiCost = data.apiCost || {};
  stats[id].remaining -= cost;
  stats[id].decisionTokens += cost;
  stats[id].decisionUsdMin += Number(apiCost.minUsd) || 0;
  stats[id].decisionUsdMax += Number(apiCost.maxUsd) || 0;
  stats[id].lastDecision = data.decision;

  const d = data.decision || { action: "pass", urgency: 0, target: null, reason: "" };
  if (d.action === "raise") {
    stats[id].raised += 1;
    setParticipantState(id, "挙手 " + Math.round(d.urgency), "raised");
  } else {
    stats[id].passed += 1;
    setParticipantState(id, "見送り", "pass");
  }

  addObserverLog(
    id + " → " + d.action +
    " / urgency=" + Math.round(d.urgency || 0) +
    (d.target ? " / target=" + d.target : "") +
    " / 判断消費=" + cost +
    " / API=" + formatUsd(apiCost.minUsd) +
    (Number(apiCost.maxUsd || 0) !== Number(apiCost.minUsd || 0) ? "～" + formatUsd(apiCost.maxUsd) : "") +
    (d.reason ? " / 理由: " + d.reason : "")
  );

  renderStats();
  return { id, decision: d };
}

async function requestSpeech(id) {
  setParticipantState(id, "発言中…", "speaking");

  const data = await postParticipant(
    "/api/participant/speak",
    {
      participant: id,
      messages,
      budget: budgetFor(id)
    },
    id,
    "発言"
  );

  const cost = Number(data.tokenCost) || 0;
  const apiCost = data.apiCost || {};
  stats[id].remaining -= cost;
  stats[id].speechTokens += cost;
  stats[id].speechUsdMin += Number(apiCost.minUsd) || 0;
  stats[id].speechUsdMax += Number(apiCost.maxUsd) || 0;
  stats[id].spoken += 1;

  messages.push({
    participant: id,
    text: data.text || "(発言なし)"
  });

  addObserverLog(
    id + " 発言 / 発言消費=" + cost +
    " / API=" + formatUsd(apiCost.minUsd) +
    (Number(apiCost.maxUsd || 0) !== Number(apiCost.minUsd || 0) ? "～" + formatUsd(apiCost.maxUsd) : "") +
    (data.continued ? " / 出力上限の自動継続 " + data.continued + "回" : "") +
    (data.truncatedAfterContinuation ? " / ※継続後も上限到達" : "")
  );
  setParticipantState(id, stats[id].remaining > 0 ? "待機" : "予算終了", stats[id].remaining > 0 ? "" : "exhausted");

  renderTranscript();
  renderStats();
}

function chooseSpeaker(raisers) {
  for (let offset = 0; offset < AI_IDS.length; offset += 1) {
    const index = (fairIndex + offset) % AI_IDS.length;
    const id = AI_IDS[index];
    if (raisers.includes(id)) {
      fairIndex = (index + 1) % AI_IDS.length;
      return id;
    }
  }
  return raisers[0] || null;
}

function enqueueRaisers(raisers) {
  const remaining = [...new Set(raisers)].filter(
    (id) => !pendingHands.includes(id) && stats[id].remaining > 0
  );

  while (remaining.length > 0) {
    const next = chooseSpeaker(remaining);
    if (!next) break;
    pendingHands.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }

  for (const id of pendingHands) {
    if (stats[id].remaining > 0) {
      setParticipantState(id, "挙手・発言待ち", "raised");
    }
  }

  if (pendingHands.length > 0) {
    addObserverLog("発言待ちキュー: " + pendingHands.join(" → "));
  }
}

function nextQueuedSpeaker() {
  while (pendingHands.length > 0) {
    const id = pendingHands.shift();
    if (stats[id]?.remaining > 0) return id;
  }
  return null;
}

function activeIds() {
  return AI_IDS.filter((id) => stats[id].remaining > 0);
}

function eligibleIds() {
  return activeIds().filter((id) => id !== lastAiSpeaker);
}

function lastPublicMessage() {
  return messages[messages.length - 1] || null;
}

async function runMeeting() {
  if (running) return;
  running = true;
  humanWantsFloor = false;
  aiChain = 0;
  pendingHands = [];
  inputEl.disabled = true;
  sendEl.disabled = true;
  takeFloorEl.disabled = false;
  takeFloorEl.textContent = "発言する（AIを止める）";

  while (true) {
    if (humanWantsFloor) {
      setHumanFloor(true, "あなたが発言権を取りました。AIは待機しています。");
      return;
    }

    const queuedSpeaker = nextQueuedSpeaker();
    if (queuedSpeaker) {
      meetingStateEl.textContent =
        queuedSpeaker + " は前の判断ラウンドで挙手済みです。発言待ちキューから発言します。";

      let spokeSuccessfully = false;
      try {
        await requestSpeech(queuedSpeaker);
        spokeSuccessfully = true;
      } catch (error) {
        setParticipantState(queuedSpeaker, "エラー", "error");
        addObserverLog(queuedSpeaker + " 発言エラー: " + error.message);
      }

      if (spokeSuccessfully) lastAiSpeaker = queuedSpeaker;
      aiChain += 1;

      if (humanWantsFloor) {
        pendingHands = [];
        setHumanFloor(true, "現在のAI発言が終わったので停止しました。あなたの番です。");
        return;
      }

      if (aiChain >= MAX_AI_CHAIN) {
        pendingHands = [];
        setHumanFloor(true, "連続AI発言が " + MAX_AI_CHAIN + " 回に達したため、安全停止しました。");
        return;
      }

      await sleep(350);
      continue;
    }

    const active = activeIds();
    if (active.length === 0) {
      setHumanFloor(true, "AI全員の会議内予算が尽きました。");
      return;
    }

    const eligible = eligibleIds();
    if (eligible.length === 0) {
      setHumanFloor(true, "直前に発言したAI以外に発言可能なAIがいないため、あなたの番です。");
      return;
    }

    decisionRound += 1;
    const trigger = lastPublicMessage();
    addObserverLog(
      "──── 判断ラウンド #" + decisionRound +
      (trigger ? " / 直前=" + trigger.participant + "「" + String(trigger.text).slice(0, 80) + (String(trigger.text).length > 80 ? "…" : "") + "」" : "") +
      " ────"
    );

    meetingStateEl.textContent = "直前の発言を受けて、発言する価値があるか各AIが判断しています…";

    const results = await Promise.all(eligible.map(async (id) => {
      try {
        return await requestDecision(id);
      } catch (error) {
        setParticipantState(id, "エラー", "error");
        addObserverLog(id + " 判断エラー: " + error.message);
        return { id, decision: { action: "pass", urgency: 0 } };
      }
    }));

    if (humanWantsFloor) {
      setHumanFloor(true, "あなたが発言権を取りました。判断処理までの使用量は消費されています。");
      return;
    }

    const raisers = results
      .filter((r) => r.decision.action === "raise" && stats[r.id].remaining > 0)
      .map((r) => r.id);

    if (raisers.length === 0) {
      setHumanFloor(true, "全AIが発言を見送りました。あなたの番です。");
      return;
    }

    enqueueRaisers(raisers);

    if (pendingHands.length === 0) {
      setHumanFloor(true, "挙手はありましたが、発言可能なAIが残っていません。あなたの番です。");
      return;
    }

    // 次のループで、挙手した順番を保持したまま発言させる。
    continue;
  }
}

async function sendHumanMessage() {
  const text = inputEl.value.trim();
  if (!text || running) return;

  messages.push({ participant: HUMAN_ID, text });
  inputEl.value = "";
  lastAiSpeaker = null;
  pendingHands = [];
  renderTranscript();

  for (const id of AI_IDS) {
    if (stats[id].remaining > 0) setParticipantState(id, "待機");
  }

  setHumanFloor(false, "あなたの発言を受けて会議を再開します。");
  running = false;
  await runMeeting();
}

takeFloorEl.addEventListener("click", () => {
  if (!running) return;
  humanWantsFloor = true;
  takeFloorEl.disabled = true;
  takeFloorEl.textContent = "停止予約済み";
  meetingStateEl.textContent = "現在のAPI処理が終わった時点で、あなたに発言権を戻します。";
});

sendEl.addEventListener("click", sendHumanMessage);
inputEl.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") sendHumanMessage();
});

resetEl.addEventListener("click", () => {
  location.reload();
});

health();
renderTranscript();
renderStats();
setHumanFloor(true, "あなたが最初の発言権を持っています。");
