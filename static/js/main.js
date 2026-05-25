// Event listeners
document.getElementById('name-input').addEventListener('keydown', e => { if(e.key==='Enter') createRoom(); });
document.getElementById('room-code-input').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('chat-send').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', e => { if(e.key==='Enter') sendChat(); });

// Initial data load
loadPvpRankings(); // PvP is the default selected mode
// (Rejoin from sessionStorage is handled by the socket 'connect' event listener.)
