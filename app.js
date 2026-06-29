import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, onValue, onDisconnect, get, update, remove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// ▼ ご自身の firebaseConfig に置き換えてください ▼
const firebaseConfig = {
    apiKey: "AIzaSyA9S9ZHfeZ0MFL32ihEJpndYvZKT_2rfJI",
    authDomain: "ai-pretend.firebaseapp.com",
    databaseURL: "https://ai-pretend-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ai-pretend",
    storageBucket: "ai-pretend.firebasestorage.app",
    messagingSenderId: "248259351182",
    appId: "1:248259351182:web:29b8f3d9a60069a8daefdf",
    measurementId: "G-GD8KLC1VT6"
  };

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let myName = "";

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

window.joinGame = function() {
  const nameInput = document.getElementById('username').value;
  if (!nameInput) return;
  
  myName = nameInput;
  const userRef = ref(db, 'users/' + myName);
  set(userRef, true);
  onDisconnect(userRef).remove();

  document.getElementById('login-area').classList.add('hidden');
  document.getElementById('game-area').classList.remove('hidden');
};

// 参加者数の変動を検知し、進行チェックを行う（離脱対策）
onValue(ref(db, 'users'), () => {
  checkAllAnswered();
  checkAllGuessed();
});

window.resetScores = function() {
  if (confirm('本当に全員のスコアをリセットしますか？')) {
    remove(ref(db, 'scores'));
  }
};

// ラウンドのリセット（スコアは維持）
window.resetRound = function() {
  if (confirm('進行状況をリセットして待機中画面に戻りますか？（スコアはそのままです）')) {
    update(ref(db), {
      'game/phase': 'waiting',
      'answers': null,
      'guesses': null
    });
  }
};

window.startGame = async function() {
  const snapshot = await get(ref(db, 'users'));
  const users = snapshot.val() || {};
  const userNames = Object.keys(users);
  if (userNames.length === 0) return;

  const randomName = userNames[Math.floor(Math.random() * userNames.length)];
  
  // 1. 前回の回答、予想、シャッフルデータを根こそぎ完全に削除
  await remove(ref(db, 'answers'));
  await remove(ref(db, 'guesses'));
  
  // 2. ゲーム状態を初期化して、新しいお題担当者を設定
  const updates = {
    'game': { 
      phase: 'theme_input', 
      themeMaker: randomName, 
      theme: '', 
      aiStatus: 'waiting',
      aiAnswer: '',
      shuffledAnswers: null 
    }
  };
  await update(ref(db), updates);

  // 3. 入力フォームの非表示状態をリセットするため、念のため画面要素もクリア
  const myAnswerInput = document.getElementById('my-answer-input');
  if (myAnswerInput) myAnswerInput.value = '';
  
  const themeInput = document.getElementById('theme-input');
  if (themeInput) themeInput.value = '';
  
  const submitGuessBtn = document.getElementById('submit-guess-btn');
  if (submitGuessBtn) submitGuessBtn.classList.add('hidden');
};

window.submitTheme = async function() {
  const theme = document.getElementById('theme-input').value;
  if (!theme) return;
  
  set(ref(db, 'game'), {
    phase: 'answering',
    themeMaker: myName,
    theme: theme,
    aiStatus: 'generating'
  });

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

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
    });
    const data = await response.json();
    const aiText = data.candidates[0].content.parts[0].text.trim();

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
  } catch (error) {
    console.error("Gemini Error:", error);
    await update(ref(db, 'game'), { aiAnswer: "エラーが発生しました", aiStatus: 'done' });
    checkAllAnswered();
  }
};

window.submitAnswer = async function() {
  const answer = document.getElementById('my-answer-input').value;
  if (!answer) return;
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
      shuffledAnswers: shuffled
    });
  }
}

window.submitGuess = async function() {
  const radios = document.getElementsByName('guess-radio');
  let selected = "";
  for (const radio of radios) {
    if (radio.checked) selected = radio.value;
  }
  if (!selected) return;

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
    await set(ref(db, 'game/phase'), 'result');
  }
}

// 画面の描画
onValue(ref(db), (snapshot) => {
  const data = snapshot.val();
  if (!data || !data.game) return;
  const game = data.game;
  const users = data.users || {};
  const answers = data.answers || {};
  const guesses = data.guesses || {};
  const scores = data.scores || {};

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

  // フェーズが guessing 以外の時はラジオボタンを初期化しておく
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
    document.getElementById('ai-status').textContent = game.aiStatus === 'done' ? "完了" : "生成中...";

    // ★修正: まだ回答していない人だけフォームを表示し、入力欄を空にする
    if (!answers[myName]) {
      const myAnswerInput = document.getElementById('my-answer-input');
      // 前回のゲームの文字が残っていたら消す
      if (myAnswerInput && !data.guesses) { 
        // 予想（guesses）データがない＝新しいラウンドが始まった直後のみクリア
        myAnswerInput.value = '';
      }
      document.getElementById('my-answer-form').classList.remove('hidden');
    } else {
      // すでに回答済みの場合はフォームを隠す
      document.getElementById('my-answer-form').classList.add('hidden');
    }
  }
  else if (game.phase === 'guessing') {
    answerInputArea.classList.add('hidden');
    guessingArea.classList.remove('hidden');
    statusMsg.textContent = `全員の回答が出揃いました！AIの回答を予想してください。（予想済み: ${Object.keys(guesses).length} 人）`;

    // ★選択が消える問題の対策：まだ生成されていない場合のみHTMLを描画する
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
        if (guessText === targetAnswer) {
          voters.push(guesser);
        }
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