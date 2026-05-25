// ── Name autocomplete + password protection ───────────────────────────────
(function () {
  const input      = document.getElementById('name-input');
  const box        = document.getElementById('name-suggestions');
  const pwField    = document.getElementById('name-password');
  const pwConfirm  = document.getElementById('name-password-confirm');
  const pwHint     = document.getElementById('password-hint');
  const protectBtn = document.getElementById('protect-name-btn');
  let activeIdx = -1;

  // Verify mode: existing protected name — one field, no confirm
  function requirePassword() {
    pwField.classList.remove('hidden');
    pwConfirm.classList.add('hidden');
    pwConfirm.value = '';
    pwHint.textContent = '🔒 This name is password-protected';
    pwHint.style.color = 'var(--gold)';
    pwHint.classList.remove('hidden');
    protectBtn.classList.add('hidden');
  }

  // Set mode: new/unprotected name — two fields
  function showSetPassword() {
    protectBtn.classList.add('hidden');
    pwField.classList.remove('hidden');
    pwConfirm.classList.remove('hidden');
    pwHint.textContent = 'Enter a password to protect this name (optional)';
    pwHint.style.color = 'var(--muted)';
    pwHint.classList.remove('hidden');
    pwField.focus();
  }

  // Reset: hide everything password-related
  function offerProtect(nameEntered) {
    pwField.classList.add('hidden');
    pwField.value = '';
    pwConfirm.classList.add('hidden');
    pwConfirm.value = '';
    pwHint.classList.add('hidden');
    protectBtn.classList.toggle('hidden', !nameEntered);
  }

  protectBtn.addEventListener('click', showSetPassword);

  let nameCheckTimer = null;
  async function checkNameStatus(name) {
    const n = (name ?? input.value).trim();
    if (!n) { offerProtect(false); return; }
    try {
      const res = await fetch(`/players/check_name?name=${encodeURIComponent(n)}`);
      const d   = await res.json();
      if (d.protected) requirePassword();
      else offerProtect(true);
    } catch(e) { offerProtect(!!n); }
  }

  function showSuggestions(matches) {
    activeIdx = -1;
    if (!matches.length) { box.classList.add('hidden'); return; }
    box.innerHTML = matches.map((n, i) =>
      `<div class="suggestion" data-idx="${i}">${escHtml(n)}</div>`
    ).join('');
    box.classList.remove('hidden');
  }

  function hideSuggestions() { box.classList.add('hidden'); activeIdx = -1; }

  function pickSuggestion(name) {
    input.value = name;
    hideSuggestions();
    checkNameStatus(name);
  }

  input.addEventListener('input', () => {
    showSuggestions(getPlayerNameSuggestions(input.value.trim()));
    clearTimeout(nameCheckTimer);
    nameCheckTimer = setTimeout(() => checkNameStatus(), 500);
  });

  input.addEventListener('focus', () => {
    showSuggestions(getPlayerNameSuggestions(input.value.trim()));
  });

  input.addEventListener('keydown', e => {
    const items = box.querySelectorAll('.suggestion');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, -1);
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && items[activeIdx]) {
        e.preventDefault();
        pickSuggestion(items[activeIdx].textContent);
      } else {
        hideSuggestions();
        createRoom();
      }
      return;
    } else if (e.key === 'Escape') {
      hideSuggestions(); return;
    }
    items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  });

  box.addEventListener('mousedown', e => {
    const item = e.target.closest('.suggestion');
    if (item) pickSuggestion(item.textContent);
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !box.contains(e.target)) hideSuggestions();
  });
})();

// ── Other event listeners ─────────────────────────────────────────────────
document.getElementById('chat-send').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

// Initial data load
loadPvpRankings();  // PvP is the default selected mode
loadPlayerNames();  // cache player names for autocomplete
// (Rejoin from sessionStorage is handled by the socket 'connect' event listener.)
