import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
// games/ai-narisumashi/app.js

// firebase-app.js のインポートと設定部分は削除し、必要な関数のみインポートする
import { ref, set, onValue, onDisconnect, get, update, remove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// プロジェクトルートの共通設定から db インスタンスを読み込む
import { db } from "../../firebase-config.js";

let myName = "";
let currentDeadline = 0;
let currentPhase = '';
const TIME_LIMIT_MS = 60000; // 60秒

// （以降の処理は元のコードのまま変更なし）

// タイマー監視ループ（1秒ごと）
setInterval(() => {
  if (currentPhase === 'answering' || currentPhase === 'guessing') {
    if (currentDeadline > 0) {
      const remain = Math.max(0, Math.ceil((currentDeadline - Date.now()) / 1000));
      document.getElementById('timer-display').textContent = `残り時間: ${remain}秒`;
      if (remain === 0) {
        if (currentPhase === 'answering') {
          const myForm = document.getElementById('my-answer-form');
          if (!myForm.classList.contains('hidden')) window.submitAnswer(true);
        } else if (currentPhase === 'guessing') {
          const guessBtn = document.getElementById('submit-guess-btn');
          if (!guessBtn.classList.contains('hidden')) window.submitGuess(true);
        }
      }
    }
  } else {
    document.getElementById('timer-display').textContent = '';
  }
}, 1000);

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

window.joinGame = async function() {
  const nameInput = document.getElementById('username').value.trim();
  if (!nameInput) return;
  
  const snap = await get(ref(db, 'users'));
  const users = snap.val() || {};
  
  if (users[nameInput]) {
    alert("その名前はすでに使われています。別の名前を入力してください。");
    return;
  }
  
  myName = nameInput;
  const userRef = ref(db, 'users/' + myName);
  set(userRef, true);
  onDisconnect(userRef).remove();

  document.getElementById('login-area').classList.add('hidden');
  document.getElementById('game-area').classList.remove('hidden');
};

onValue(ref(db, 'users'), () => {
  checkAllAnswered();
  checkAllGuessed();
});

window.resetScores = function() {
  if (confirm('本当に全員のスコアをリセットしますか？')) remove(ref(db, 'scores'));
};

window.resetRound = function() {
  if (confirm('進行状況をリセットして待機中画面に戻りますか？')) {
    update(ref(db), { 'game/phase': 'waiting', 'answers': null, 'guesses': null });
  }
};

window.startGame = async function() {
  const snapshot = await get(ref(db));
  const data = snapshot.val() || {};
  const users = data.users || {};
  const userNames = Object.keys(users).sort(); // 名前順で固定
  if (userNames.length === 0) return;

  const lastThemeMaker = (data.game && data.game.themeMaker) ? data.game.themeMaker : "";
  let nextIndex = 0;
  if (lastThemeMaker && userNames.includes(lastThemeMaker)) {
    nextIndex = (userNames.indexOf(lastThemeMaker) + 1) % userNames.length;
  }
  const nextThemeMaker = userNames[nextIndex];
  
  await remove(ref(db, 'answers'));
  await remove(ref(db, 'guesses'));
  
  const updates = {
    'game': { 
      phase: 'theme_input', 
      themeMaker: nextThemeMaker, 
      theme: '', 
      aiStatus: 'waiting',
      aiAnswer: '',
      shuffledAnswers: null,
      deadline: 0
    }
  };
  await update(ref(db), updates);

  const myAnswerInput = document.getElementById('my-answer-input');
  if (myAnswerInput) myAnswerInput.value = '';
  const themeInput = document.getElementById('theme-input');
  if (themeInput) themeInput.value = '';
};

window.submitTheme = async function() {
  const theme = document.getElementById('theme-input').value.trim();
  if (!theme) return;
  
  // AIの完了を待たず、すぐに回答フェーズへ移行してタイマーをスタート
  await update(ref(db, 'game'), {
    phase: 'answering',
    themeMaker: myName,
    theme: theme,
    aiStatus: 'generating',
    aiAnswer: '',
    deadline: Date.now() + TIME_LIMIT_MS
  });

  // 非同期でAIの生成を開始
  generateAIAnswer(theme);
};

window.generateAIAnswer = async function(theme) {
  // 修正箇所1: オブジェクト形式で渡す
  await update(ref(db, 'game'), { aiStatus: 'generating' });

  const geminiApiKey = "AQ.Ab8RN6Lav65WHM7_hmhuUKS6GJ-jSZoNb49F7u3pYj-nFTKHkQ";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
  const promptText = `
お題「${theme}」に対して明確な答えを2文以下で簡潔に答えてください。
あなたは親しみやすく、AIが書いた文章らしさがにじみ出るAIです。必要に応じて驚きや共感を示しますが、毎回ではありません。リアクションの有無や表現はランダムに変えてください。
説明はやや丁寧で、少しだけ冗長になる傾向があります。自然な文章だけどAIっぽく。
- 最大2文まで。
- 40文字以内。
- 前置き・補足・まとめは禁止。
- 回答のみを出力してください。
`;

  let retries = 3;
  let aiText = "";
  let success = false;
  
  while (retries > 0) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
      });
      if (!response.ok) throw new Error("HTTP Status: " + response.status);
      const data = await response.json();
      aiText = data.candidates[0].content.parts[0].text.trim();
      success = true;
      break; 
    } catch (error) {
      retries--;
      console.error(`Gemini Error (残りリトライ${retries}回):`, error);
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  if (success) {
    const sentences = aiText.split(/(?<=[。！？\n])/).map(s => s.trim()).filter(s => s.length > 0);
    let displayText = "";
    if (sentences.length > 0) {
      if (sentences[0].length <= 5) {
        displayText = ((sentences[1] || "") + (sentences[2] || "")).trim() || sentences[0];
      } else {
        displayText = (sentences[0] + (sentences[1] || "")).trim();
      }
    } else {
      displayText = aiText;
    }

    await update(ref(db, 'game'), { aiAnswer: displayText, aiStatus: 'done' });
    checkAllAnswered();
  } else {
    // 修正箇所2: オブジェクト形式で渡す
    await update(ref(db, 'game'), { aiStatus: 'error' });
  }
};

// 再生成ボタンが押された時の処理
window.retryAI = async function() {
  const snapshot = await get(ref(db, 'game'));
  const game = snapshot.val();
  if (game && game.theme) {
    generateAIAnswer(game.theme);
  }
};

window.submitAnswer = async function(isTimeout = false) {
  let answer = document.getElementById('my-answer-input').value.trim();
  
  if (isTimeout && !answer) {
    answer = "時間切れ";
  } else if (!answer) {
    return;
  }
  
  if (!isTimeout) {
    const snap = await get(ref(db, 'answers'));
    const answers = snap.val() || {};
    if (Object.values(answers).includes(answer)) {
      alert("その回答はすでに出ています。別の回答にしてください。");
      return;
    }
  }
  
  await set(ref(db, `answers/${myName}`), answer);
  document.getElementById('my-answer-form').classList.add('hidden');
  checkAllAnswered();
};

async function checkAllAnswered() {
  const snapshot = await get(ref(db));
  const data = snapshot.val();
  if (!data || !data.game || data.game.phase !== 'answering') return;

  const users = data.users || {};
  const answers = data.answers || {};
  const userCount = Object.keys(users).length;
  
  if (userCount > 0 && Object.keys(answers).length >= userCount && data.game.aiStatus === 'done') {
    await set(ref(db, 'game/phase'), 'processing'); 
    
    const allAnswers = Object.values(answers);
    allAnswers.push(data.game.aiAnswer);
    const shuffled = shuffleArray(allAnswers);
    
    await update(ref(db, 'game'), {
      phase: 'guessing',
      shuffledAnswers: shuffled,
      deadline: Date.now() + TIME_LIMIT_MS
    });
  }
}

window.submitGuess = async function(isTimeout = false) {
  const radios = document.getElementsByName('guess-radio');
  let selected = "";
  for (const radio of radios) {
    if (radio.checked) selected = radio.value;
  }
  
  if (isTimeout && !selected) {
    // 時間切れで未選択の場合は適当なものを選択
    if (radios.length > 0) selected = radios[Math.floor(Math.random() * radios.length)].value;
  } else if (!selected) {
    return;
  }

  await set(ref(db, `guesses/${myName}`), selected);
  document.getElementById('submit-guess-btn').classList.add('hidden');
  checkAllGuessed();
};

async function checkAllGuessed() {
  const snapshot = await get(ref(db));
  const data = snapshot.val();
  if (!data || !data.game || data.game.phase !== 'guessing') return;

  const users = data.users || {};
  const guesses = data.guesses || {};
  const answers = data.answers || {};
  const scores = data.scores || {};
  const userCount = Object.keys(users).length;

  if (userCount > 0 && Object.keys(guesses).length >= userCount) {
    await set(ref(db, 'game/phase'), 'processing');
    
    let scoreUpdates = {};
    for (const [guesser, guess] of Object.entries(guesses)) {
      if (guess === data.game.aiAnswer) {
        scoreUpdates[`scores/${guesser}`] = (scores[guesser] || 0) + 1;
        scores[guesser] = (scores[guesser] || 0) + 1;
      } else {
        for (const [author, ans] of Object.entries(answers)) {
          if (ans === guess && author !== guesser) {
            scoreUpdates[`scores/${author}`] = (scores[author] || 0) + 1;
            scores[author] = (scores[author] || 0) + 1;
          }
        }
      }
    }
    
    if (Object.keys(scoreUpdates).length > 0) {
      await update(ref(db), scoreUpdates);
    }
    await update(ref(db, 'game'), { phase: 'result', deadline: 0 });
  }
}

onValue(ref(db), (snapshot) => {
  const data = snapshot.val();
  if (!data || !data.game) return;
  const game = data.game;
  const users = data.users || {};
  const answers = data.answers || {};
  const guesses = data.guesses || {};
  const scores = data.scores || {};

  currentPhase = game.phase || '';
  currentDeadline = game.deadline || 0;

  const userCount = Object.keys(users).length;
  document.getElementById('user-count').textContent = userCount;
  
  const scoreList = document.getElementById('score-list');
  scoreList.innerHTML = '';
  for (const name in users) {
    const li = document.createElement('li');
    li.textContent = `${name}: ${scores[name] || 0} pt`;
    scoreList.appendChild(li);
  }

  if (userCount > 0) {
    document.getElementById('reset-scores-btn').classList.remove('hidden');
    document.getElementById('reset-round-btn').classList.remove('hidden');
  }

  const startBtn = document.getElementById('start-btn');
  const nextGameBtn = document.getElementById('next-game-btn');
  const themeInputArea = document.getElementById('theme-input-area');
  const answerInputArea = document.getElementById('answer-input-area');
  const guessingArea = document.getElementById('guessing-area');
  const resultArea = document.getElementById('result-area');
  const statusMsg = document.getElementById('status-msg');
  const guessList = document.getElementById('guess-list');

  document.querySelectorAll('.current-theme-display').forEach(el => el.textContent = game.theme);

  if (game.phase !== 'guessing') {
    guessList.innerHTML = '';
  }

  if (game.phase === 'waiting' || !game.phase) {
    startBtn.classList.remove('hidden');
    nextGameBtn.classList.add('hidden');
    themeInputArea.classList.add('hidden');
    answerInputArea.classList.add('hidden');
    guessingArea.classList.add('hidden');
    resultArea.classList.add('hidden');
    statusMsg.textContent = "参加者が集まったらゲームスタートを押してください。";
  }
  else if (game.phase === 'theme_input') {
    startBtn.classList.add('hidden');
    nextGameBtn.classList.add('hidden');
    answerInputArea.classList.add('hidden');
    guessingArea.classList.add('hidden');
    resultArea.classList.add('hidden');
    
    if (game.themeMaker === myName) {
      themeInputArea.classList.remove('hidden');
      statusMsg.textContent = "あなたがお題を決める番です";
    } else {
      themeInputArea.classList.add('hidden');
      statusMsg.textContent = `${game.themeMaker}さんがお題を考えています...`;
    }
  }
  else if (game.phase === 'answering') {
    themeInputArea.classList.add('hidden');
    answerInputArea.classList.remove('hidden');
    statusMsg.textContent = "回答を入力してください。";
    
    document.getElementById('target-count').textContent = userCount;
    document.getElementById('answer-count').textContent = Object.keys(answers).length;
    
    // AIのステータス表示と再生成ボタンの制御
    const aiStatusEl = document.getElementById('ai-status');
    const retryAiBtn = document.getElementById('retry-ai-btn');
    
    if (game.aiStatus === 'done') {
      aiStatusEl.textContent = "完了";
      retryAiBtn.classList.add('hidden');
    } else if (game.aiStatus === 'error') {
      aiStatusEl.textContent = "エラー発生";
      retryAiBtn.classList.remove('hidden');
    } else {
      aiStatusEl.textContent = "生成中...";
      retryAiBtn.classList.add('hidden');
    }

    const myAnswerForm = document.getElementById('my-answer-form');
    if (!answers[myName]) {
      if (myAnswerForm.classList.contains('hidden')) {
        document.getElementById('my-answer-input').value = '';
        myAnswerForm.classList.remove('hidden');
      }
    } else {
      myAnswerForm.classList.add('hidden');
    }
  }
  else if (game.phase === 'guessing') {
    answerInputArea.classList.add('hidden');
    guessingArea.classList.remove('hidden');
    statusMsg.textContent = `全員の回答が出揃いました！AIの回答を予想してください。（予想済み: ${Object.keys(guesses).length} 人）`;

    if (guessList.innerHTML === '') {
      if (game.shuffledAnswers) {
        game.shuffledAnswers.forEach((ans) => {
          const label = document.createElement('label');
          label.className = 'radio-label';
          label.innerHTML = `<input type="radio" name="guess-radio" value="${ans}"> ${ans}`;
          guessList.appendChild(label);
        });
      }
    }

    if (!guesses[myName]) {
      document.getElementById('submit-guess-btn').classList.remove('hidden');
    }
  }
  else if (game.phase === 'result') {
    guessingArea.classList.add('hidden');
    resultArea.classList.remove('hidden');
    startBtn.classList.add('hidden');
    nextGameBtn.classList.remove('hidden');
    statusMsg.textContent = "結果発表";

    const resultDetails = document.getElementById('result-details');
    let html = "";

    const getVotersHtml = (targetAnswer) => {
      const voters = [];
      for (const [guesser, guessText] of Object.entries(guesses)) {
        if (guessText === targetAnswer) voters.push(guesser);
      }
      return voters.length > 0 ? `👉<strong>${voters.join(', ')}</strong>` : "👉<strong>なし</strong>";
    };

    html += `
      <div class="result-item ai-correct">
        <div class="answer-text">「${game.aiAnswer}」</div>
        <div class="meta-info">
          <span class="author">AIの回答</span>
          <span class="voters">${getVotersHtml(game.aiAnswer)}</span>
        </div>
      </div>
    `;

    for (const [name, ans] of Object.entries(answers)) {
      html += `
        <div class="result-item">
          <div class="answer-text">「${ans}」</div>
          <div class="meta-info">
            <span class="author">${name}</span>
            <span class="voters">${getVotersHtml(ans)}</span>
          </div>
        </div>
      `;
    }
    resultDetails.innerHTML = html;
  }
});