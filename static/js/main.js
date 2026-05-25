// ── Name autocomplete ─────────────────────────────────────────────────────
(function () {
  const input = document.getElementById('name-input');
  const box   = document.getElementById('name-suggestions');
  let activeIdx = -1;

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
  }

  input.addEventListener('input', () => {
    showSuggestions(getPlayerNameSuggestions(input.value.trim()));
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
