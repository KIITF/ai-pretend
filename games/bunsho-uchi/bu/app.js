import { ref, set, onValue, onDisconnect, get, update, remove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { db } from "../../firebase-config.js";

let myName = "";
let opponentName = "";

const DB_PATH = 'bunsho_uchi';

window.forceReset = async function() {
  await remove(ref(db, DB_PATH));
  location.reload();
};

window.joinGame = async function() {
  const nameInput = document.getElementById('username').value.trim();
  if (!nameInput) return;

  const snap = await get(ref(db, `${DB_PATH}/users`));
  const users = snap.val() || {};
  
  if (Object.keys(users).length >= 2 && !users[nameInput]) {
    alert("満員です。");
    return;
  }

  myName = nameInput;
  const userRef = ref(db, `${DB_PATH}/users/${myName}`);
  await set(userRef, true);
  onDisconnect(userRef).remove();

  document.getElementById('login-area').classList.add('hidden');

  const gameSnap = await get(ref(db, `${DB_PATH}/game`));
  const game = gameSnap.val() || {};

  if (!gameSnap.exists()) {
    await set(ref(db, `${DB_PATH}/game`), { phase: 'waiting_players' });
  } else if (game.phase === 'waiting_players') {
    const currentUsers = (await get(ref(db, `${DB_PATH}/users`))).val() || {};
    if (Object.keys(currentUsers).length >= 2) {
      await update(ref(db, `${DB_PATH}/game`), {
        phase: 'input_lyrics',
        players: Object.keys(currentUsers).slice(0, 2)
      });
    }
  }
};

onValue(ref(db, DB_PATH), (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  const users = data.users || {};
  const userNames = Object.keys(users);
  const game = data.game || {};

  if (userNames.includes(myName)) {
    opponentName = userNames.find(n => n !== myName) || "";
  }

  updateUI(game);
});

function getOpenCount(game, playerName) {
  if (!game || !game.players) return 1;
  const isPlayer1 = (playerName === game.players[0]);
  const turns = game.turns && game.turns[playerName] ? game.turns[playerName] : 1;
  return isPlayer1 ? turns + 1 : turns + 2;
}

function updateUI(game) {
  if (game.phase === 'waiting_players') {
    document.getElementById('waiting-players-area').classList.remove('hidden');
  } else {
    const el = document.getElementById('waiting-players-area');
    if (el) el.classList.add('hidden');
  }

  if (game.phase === 'input_lyrics') {
    document.getElementById('lyrics-input-area').classList.remove('hidden');
    if (game.lyrics && game.lyrics[myName]) {
      document.getElementById('waiting-opponent-msg').classList.remove('hidden');
    }
  } else {
    document.getElementById('lyrics-input-area').classList.add('hidden');
  }

  if (game.phase === 'playing') {
    document.getElementById('playing-area').classList.remove('hidden');
    
    const isMyTurn = game.currentPlayer === myName;
    const myN = getOpenCount(game, myName);
    const oppN = getOpenCount(game, opponentName);

    const mySection = document.getElementById('my-board-section');
    const oppSection = document.getElementById('opponent-board-section');
    const myIndicator = document.getElementById('my-turn-indicator');
    const oppIndicator = document.getElementById('opponent-turn-indicator');

    if (isMyTurn) {
      document.getElementById('turn-status').textContent = `自分のターン (${myN}文字)`;
      
      if (mySection) mySection.classList.add('active');
      if (oppSection) oppSection.classList.remove('active');
      if (myIndicator) myIndicator.classList.remove('hidden');
      if (oppIndicator) oppIndicator.classList.add('hidden');

      renderBoard('my-guess-board', game.lyrics[opponentName], game.masks[opponentName], true, myN, opponentName);
      renderBoard('opponent-guess-board', game.lyrics[myName], game.masks[myName], false, oppN, myName);
    } else {
      document.getElementById('turn-status').textContent = `相手のターン (${oppN}文字)`;
      
      if (oppSection) oppSection.classList.add('active');
      if (mySection) mySection.classList.remove('active');
      if (oppIndicator) oppIndicator.classList.remove('hidden');
      if (myIndicator) myIndicator.classList.add('hidden');

      renderBoard('my-guess-board', game.lyrics[opponentName], game.masks[opponentName], false, myN, opponentName);
      renderBoard('opponent-guess-board', game.lyrics[myName], game.masks[myName], false, oppN, myName);
    }
  } else {
    document.getElementById('playing-area').classList.add('hidden');
  }
}

window.submitLyrics = async function() {
  const text = document.getElementById('my-lyrics').value.trim();
  if (!text) return;

  await update(ref(db, `${DB_PATH}/game/lyrics`), { [myName]: text });
  
  const mask = Array(text.length).fill(false);
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' || text[i] === ' ' || text[i] === '\n') {
      mask[i] = true;
    }
  }
  await update(ref(db, `${DB_PATH}/game/masks`), { [myName]: mask });

  const snap = await get(ref(db, `${DB_PATH}/game`));
  const game = snap.val();
  if (game.lyrics && Object.keys(game.lyrics).length >= 2) {
    await update(ref(db, `${DB_PATH}/game`), {
      phase: 'playing',
      currentPlayer: game.players[0],
      turns: { [game.players[0]]: 1, [game.players[1]]: 1 }
    });
  }
};

function getSelectableIndices(text, mask, n) {
  let selectable = Array(text.length).fill(false);
  let foundAny = false;

  for (let dist = 3; dist >= 0; dist--) {
    for (let i = 0; i < text.length; i++) {
      if (mask[i]) continue;

      let openedCount = 0;
      let endIdx = i;
      for (let j = i; j < text.length && openedCount < n; j++) {
        if (!mask[j]) {
          openedCount++;
          endIdx = j;
        }
      }

      let isValid = true;
      for (let k = i - dist; k <= endIdx + dist; k++) {
        if (k >= 0 && k < text.length) {
          if (mask[k] && text[k] !== ' ' && text[k] !== ' ' && text[k] !== '\n') {
            isValid = false;
            break;
          }
        }
      }

      if (isValid) {
        selectable[i] = true;
        foundAny = true;
      }
    }
    if (foundAny) break;
  }
  return selectable;
}

function renderBoard(containerId, text, mask, isInteractive, n, targetPlayer) {
  const container = document.getElementById(containerId);
  if (!container) return; 
  container.innerHTML = '';
  if (!text) return;

  let selectableIndices = [];
  if (isInteractive) {
    selectableIndices = getSelectableIndices(text, mask, n);
  }

  for (let i = 0; i < text.length; i++) {
    const charDiv = document.createElement('div');
    charDiv.className = 'char-box';

    if (text[i] === '\n') {
      charDiv.style.flexBasis = '100%';
      charDiv.style.height = '0';
      charDiv.style.border = 'none';
      charDiv.style.margin = '0';
      charDiv.style.padding = '0';
    } else if (text[i] === ' ' || text[i] === ' ') {
      charDiv.style.borderColor = 'transparent';
      charDiv.style.background = 'transparent';
      charDiv.textContent = '';
    } else if (mask && mask[i]) {
      charDiv.textContent = text[i];
      charDiv.classList.add('opened');
    } else {
      charDiv.textContent = '';
      if (isInteractive) {
        if (selectableIndices[i]) {
          charDiv.classList.add('selectable');
          charDiv.onmouseenter = () => highlight(containerId, i, n, text.length, mask);
          charDiv.onmouseleave = () => clearHighlight(containerId);
          charDiv.onclick = () => window.openChars(i, n, text.length, mask, targetPlayer);
        } else {
          charDiv.style.cursor = 'not-allowed';
          charDiv.style.opacity = '0.4';
        }
      }
    }
    container.appendChild(charDiv);
  }
}

function highlight(containerId, startIdx, n, len, mask) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const boxes = container.children;
  let highlighted = 0;
  for (let i = startIdx; i < len && highlighted < n; i++) {
    if (!mask[i]) {
      if(boxes[i]) boxes[i].classList.add('preview-open');
      highlighted++;
    }
  }
}

function clearHighlight(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const boxes = container.children;
  for (let i = 0; i < boxes.length; i++) {
    if(boxes[i]) boxes[i].classList.remove('preview-open');
  }
}

window.openChars = async function(startIdx, n, len, mask, targetPlayer) {
  let opened = 0;
  let newMask = [...(mask || Array(len).fill(false))];
  for (let i = startIdx; i < len && opened < n; i++) {
    if (!newMask[i]) {
      newMask[i] = true;
      opened++;
    }
  }
  
  const snap = await get(ref(db, `${DB_PATH}/game`));
  const game = snap.val();
  const currentTurn = game.turns[myName] || 1;

  await update(ref(db, `${DB_PATH}/game/masks`), { [targetPlayer]: newMask });
  await update(ref(db, `${DB_PATH}/game/turns`), { [myName]: currentTurn + 1 });
  await update(ref(db, `${DB_PATH}/game`), { currentPlayer: opponentName });
};