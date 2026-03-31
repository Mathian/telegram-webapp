/* ============================================================
   CHAT — Support chat (user ↔ admin)
   ============================================================ */

let _unsubSupportChat = null;

function openSupportChat() {
  STATE.supportChatFrom = STATE.role;
  showScreen('s-support');
  loadSupportMsgs();
}

function closeSupportChat() {
  if (_unsubSupportChat) { _unsubSupportChat(); _unsubSupportChat = null; }
  showScreen(STATE.supportChatFrom === 'driver' ? 's-driver' : 's-passenger');
}

async function loadSupportMsgs() {
  if (!STATE.user) return;
  const chatId = 'support_' + STATE.user.tgId;
  const msgsEl = document.getElementById('support-msgs');
  if (!msgsEl) return;

  // Show greeting always
  const renderMsgs = msgs => {
    const sorted = msgs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const extra = sorted.map(m => `
      <div class="msg ${m.from === 'user' ? 'msg-out' : 'msg-in'}">
        ${escHtml(m.text)}
        <div class="msg-time">${fmtTime(m.createdAt)}</div>
      </div>`).join('');
    msgsEl.innerHTML = `
      <div class="msg msg-in">
        Привет! Чем могу помочь? 😊
        <div class="msg-time"></div>
      </div>${extra}`;
    msgsEl.scrollTop = msgsEl.scrollHeight;
  };

  if (_unsubSupportChat) _unsubSupportChat();
  _unsubSupportChat = onSnapshotQuery('chats', 'chatId', '==', chatId, renderMsgs);
}

async function sendSupportMsg() {
  if (!STATE.user) return;
  const input = document.getElementById('support-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const chatId = 'support_' + STATE.user.tgId;
  await dbSet('chats', 'MSG-' + Date.now(), {
    chatId,
    from: 'user',
    text,
    userId: STATE.user.tgId,
    userName: STATE.user.name,
    createdAt: new Date().toISOString()
  });
  setTimeout(() => {
    const el = document.getElementById('support-msgs');
    if (el) el.scrollTop = el.scrollHeight;
  }, 100);
}
