// Event listeners
document.getElementById('name-select').addEventListener('change', function () {
  const input = document.getElementById('name-input');
  if (this.value === '__new__') {
    input.classList.remove('hidden');
    input.focus();
  } else {
    input.classList.add('hidden');
  }
});
document.getElementById('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
document.getElementById('chat-send').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

// Initial data load
loadPvpRankings();   // PvP is the default selected mode
loadPlayerNames();   // populate name dropdown
// (Rejoin from sessionStorage is handled by the socket 'connect' event listener.)
