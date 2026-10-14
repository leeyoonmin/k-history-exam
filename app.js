// 한능검 AI 마스터 — Main Application Controller
(() => {
  const SAVE_KEY = 'k_history_exam_save_v1';
  const CIRCLE_NUMS = ['①', '②', '③', '④', '⑤'];

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          solvedCount: p.solvedCount || 0,
          correctCount: p.correctCount || 0,
          streak: p.streak || 0,
          bestExamScore: p.bestExamScore || 0,
          geminiKey: p.geminiKey || '',
          wrongNotes: Array.isArray(p.wrongNotes) ? p.wrongNotes : [],
          examRounds: Array.isArray(p.examRounds) ? p.examRounds : []
        };
      }
    } catch (e) {}
    return {
      solvedCount: 0,
      correctCount: 0,
      streak: 0,
      bestExamScore: 0,
      geminiKey: '',
      wrongNotes: [],
      examRounds: []
    };
  }

  const store = loadState();
  function saveState() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  // Ensure at least Round 1 Mock Exam exists on first launch
  if (store.examRounds.length === 0) {
    store.examRounds.push({
      round: 1,
      title: '제1회 AI 한국사 심화 실전 모의고사',
      createdAt: new Date().toLocaleDateString('ko-KR'),
      questions: window.KHistoryEngine.generateFull50Exam(1),
      userAnswers: new Array(50).fill(-1),
      starred: new Array(50).fill(false),
      remainSec: 80 * 60,
      completed: false,
      score: null
    });
    saveState();
  }

  // Active runtime state
  let currentTab = 'tabHome';
  let randomEraFilter = 'all';
  let currentRandomQ = null;
  let randomAnswered = false;

  let activeExamIdx = 0; // index in store.examRounds
  let activeQIdx = 0;    // 0..49
  let examTimerInterval = null;
  let reviewFilter = 'all'; // 'all' | 'wrong' | 'starred'

  function showToast(msg) {
    const el = document.getElementById('toastMsg');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._tid);
    el._tid = setTimeout(() => el.classList.add('hidden'), 2400);
  }

  // ================= TAB NAVIGATION =================
  function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll('.tab-view').forEach(s => {
      s.classList.toggle('active', s.id === tabId);
    });
    document.querySelectorAll('.nav-tab-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-target') === tabId);
    });

    if (tabId === 'tabHome') {
      stopExamTimer();
      renderHomeDashboard();
    } else if (tabId === 'tabRandom') {
      stopExamTimer();
      if (!currentRandomQ) loadNextRandomQuestion(false);
    } else if (tabId === 'tabExam') {
      renderActiveExam();
      startExamTimer();
    } else if (tabId === 'tabNotes') {
      stopExamTimer();
      renderWrongNotes();
      renderEraSummaries();
    }
    document.querySelector('.app-main').scrollTop = 0;
  }

  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-target')));
  });

  // ================= TAB 1: HOME & MOCK EXAM GENERATOR =================
  function renderHomeDashboard() {
    document.getElementById('statSolvedCount').textContent = `${store.solvedCount}문항`;
    document.getElementById('statBestScore').textContent = store.bestExamScore > 0 ? `${store.bestExamScore}점` : '- 점';
    const acc = store.solvedCount > 0 ? Math.round((store.correctCount / store.solvedCount) * 100) : 0;
    document.getElementById('statAccuracy').textContent = `${acc}%`;
    document.getElementById('statWrongCount').textContent = `${store.wrongNotes.length}개`;

    const badge = document.getElementById('predictedGradeBadge');
    if (store.bestExamScore >= 80) badge.textContent = '🏆 1급 수준 (80점↑)';
    else if (store.bestExamScore >= 70) badge.textContent = '🥈 2급 수준 (70점↑)';
    else if (store.bestExamScore >= 60) badge.textContent = '🥉 3급 수준 (60점↑)';
    else badge.textContent = '🎯 1급 합격 도전';

    document.getElementById('examCountLabel').textContent = `총 ${store.examRounds.length}회차 생성됨`;
    const listEl = document.getElementById('examRoundsList');
    listEl.innerHTML = '';

    store.examRounds.slice().reverse().forEach((ex) => {
      const realIdx = store.examRounds.indexOf(ex);
      const answeredCnt = ex.userAnswers.filter(a => a !== -1).length;
      const card = document.createElement('div');
      card.className = 'exam-round-card';

      let statusTxt = `진행 중 (${answeredCnt}/50문항 마킹) · 50문항 100점 만점`;
      if (ex.completed) {
        const gradeStr = ex.score >= 80 ? '🏆 1급 합격' : ex.score >= 70 ? '🥈 2급 합격' : ex.score >= 60 ? '🥉 3급 합격' : '불합격';
        statusTxt = `채점 완료: ${ex.score}점 (${gradeStr}) · 오답 및 전 문항 해설 제공`;
      }

      card.innerHTML = `
        <div class="erc-info">
          <div class="erc-title">📝 ${ex.title}</div>
          <div class="erc-meta">${statusTxt}</div>
        </div>
        <button class="erc-btn ${ex.completed ? 'done' : ''}" type="button">
          ${ex.completed ? '성적·해설 보기' : (answeredCnt > 0 ? '이어서 풀기' : '시험 시작 ▶')}
        </button>
      `;

      card.querySelector('button').addEventListener('click', () => {
        activeExamIdx = realIdx;
        activeQIdx = 0;
        switchTab('tabExam');
      });
      listEl.appendChild(card);
    });
  }

  // Generate a brand-new 50-question AI Mock Exam round!
  document.getElementById('btnGenerateNewExam').addEventListener('click', () => {
    const nextRound = store.examRounds.length + 1;
    const newExam = {
      round: nextRound,
      title: `제${nextRound}회 AI 한국사 심화 실전 모의고사`,
      createdAt: new Date().toLocaleDateString('ko-KR'),
      questions: window.KHistoryEngine.generateFull50Exam(nextRound + Math.floor(Math.random() * 1000)),
      userAnswers: new Array(50).fill(-1),
      starred: new Array(50).fill(false),
      remainSec: 80 * 60,
      completed: false,
      score: null
    };
    store.examRounds.push(newExam);
    saveState();
    activeExamIdx = store.examRounds.length - 1;
    activeQIdx = 0;
    showToast(`🤖 제${nextRound}회 50문항 AI 모의고사가 새로 생성되었습니다!`);
    switchTab('tabExam');
  });

  document.getElementById('btnQuickRandomStart').addEventListener('click', () => {
    switchTab('tabRandom');
  });

  // ================= TAB 2: RANDOM 1-QUESTION SPEED PRACTICE =================
  document.querySelectorAll('#randomEraFilterBar .era-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#randomEraFilterBar .era-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      randomEraFilter = chip.getAttribute('data-era');
      loadNextRandomQuestion(false);
    });
  });

  async function loadNextRandomQuestion(useLiveLlm = false) {
    randomAnswered = false;
    document.getElementById('rqExplanationBox').classList.add('hidden');
    const aiBtn = document.getElementById('btnAiLiveSingle');

    if (useLiveLlm) {
      aiBtn.disabled = true;
      aiBtn.innerHTML = '<span>⏳ AI 출제위원 생성 중...</span>';
    }

    const q = await window.KHistoryEngine.generateSingleAiQuestion(randomEraFilter, useLiveLlm, store.geminiKey);
    currentRandomQ = q;

    if (useLiveLlm) {
      aiBtn.disabled = false;
      aiBtn.innerHTML = '<span>🤖 AI 실시간 신규출제</span>';
      showToast(`${q.llmBadge || '🤖 AI 신규 문제'} 출제 완료!`);
    }

    renderRandomQuestion();
  }

  function renderRandomQuestion() {
    if (!currentRandomQ) return;
    const q = currentRandomQ;
    document.getElementById('rqEraBadge').textContent = q.eraName;
    document.getElementById('rqPointsBadge').textContent = `${q.points}점 · ${q.title}`;
    document.getElementById('rqAiBadge').textContent = q.llmBadge || '⚡ AI 사료 조합';
    document.getElementById('rqStreakText').textContent = `🔥 연속 ${store.streak}정답`;

    document.getElementById('rqStem').textContent = q.stem;
    document.getElementById('rqSourceBox').textContent = q.source;

    const listEl = document.getElementById('rqChoicesList');
    listEl.innerHTML = '';

    q.choices.forEach((cText, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-option-btn';
      btn.innerHTML = `
        <span class="choice-num-circle">${idx + 1}</span>
        <span>${cText}</span>
      `;
      btn.addEventListener('click', () => onSelectRandomChoice(idx));
      listEl.appendChild(btn);
    });
  }

  function onSelectRandomChoice(chosenIdx) {
    if (randomAnswered || !currentRandomQ) return;
    randomAnswered = true;
    const q = currentRandomQ;
    const isCorrect = chosenIdx === q.answer;

    store.solvedCount++;
    if (isCorrect) {
      store.correctCount++;
      store.streak++;
    } else {
      store.streak = 0;
      addWrongNote(q, chosenIdx);
    }
    saveState();

    document.getElementById('rqStreakText').textContent = `🔥 연속 ${store.streak}정답`;

    const choiceBtns = document.querySelectorAll('#rqChoicesList .choice-option-btn');
    choiceBtns.forEach((btn, idx) => {
      if (idx === q.answer) btn.classList.add('correct');
      else if (idx === chosenIdx && !isCorrect) btn.classList.add('wrong');
    });

    const banner = document.getElementById('rqResultBanner');
    banner.className = `exp-result-banner ${isCorrect ? 'ok' : 'no'}`;
    banner.textContent = isCorrect
      ? `⭕ 정답입니다! (${CIRCLE_NUMS[q.answer]}번 정답 · +${q.points}점)`
      : `❌ 아쉽습니다! 정답은 ${CIRCLE_NUMS[q.answer]}번입니다. (오답노트에 자동 저장됨)`;

    const kwRow = document.getElementById('rqKeywordsRow');
    kwRow.innerHTML = (q.keywords || []).map(k => `<span class="kw-chip">🔑 ${k}</span>`).join('');

    document.getElementById('rqExpText').textContent = q.explanation;

    const detailUl = document.getElementById('rqChoiceDetailsList');
    detailUl.innerHTML = (q.choiceDetails || []).map(line => `<li>${line}</li>`).join('');

    const expBox = document.getElementById('rqExplanationBox');
    expBox.classList.remove('hidden');
    setTimeout(() => {
      expBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  document.getElementById('btnNextRandomQ').addEventListener('click', () => {
    loadNextRandomQuestion(false);
    document.querySelector('.app-main').scrollTop = 0;
  });

  document.getElementById('btnAiLiveSingle').addEventListener('click', () => {
    loadNextRandomQuestion(true);
    document.querySelector('.app-main').scrollTop = 0;
  });

  // ================= TAB 3: 50-QUESTION MOCK EXAM ARENA =================
  function getActiveExam() {
    return store.examRounds[activeExamIdx] || store.examRounds[0];
  }

  function startExamTimer() {
    stopExamTimer();
    const ex = getActiveExam();
    if (!ex || ex.completed) return;

    examTimerInterval = setInterval(() => {
      if (document.hidden) return;
      if (ex.remainSec > 0) {
        ex.remainSec--;
        updateExamTimerDisplay();
      } else {
        stopExamTimer();
        gradeAndSubmitExam();
      }
    }, 1000);
  }

  function stopExamTimer() {
    if (examTimerInterval) {
      clearInterval(examTimerInterval);
      examTimerInterval = null;
    }
  }

  function updateExamTimerDisplay() {
    const ex = getActiveExam();
    if (!ex) return;
    const m = Math.floor((ex.remainSec || 0) / 60);
    const s = (ex.remainSec || 0) % 60;
    document.getElementById('examTimerText').textContent = `⏱️ ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function renderActiveExam() {
    const ex = getActiveExam();
    if (!ex) return;

    document.getElementById('examTitleText').textContent = `제${ex.round}회 AI 모의고사`;
    updateExamTimerDisplay();

    const answeredCnt = ex.userAnswers.filter(a => a !== -1).length;
    document.getElementById('btnToggleOmr').textContent = `📋 OMR (${answeredCnt}/50)`;

    const activeArea = document.getElementById('examActiveArea');
    const navFooter = document.getElementById('examNavFooter');
    const resultArea = document.getElementById('examResultArea');
    const submitBtn = document.getElementById('btnSubmitExam');

    if (ex.completed) {
      activeArea.classList.add('hidden');
      navFooter.classList.add('hidden');
      document.getElementById('omrDrawer').classList.add('hidden');
      resultArea.classList.remove('hidden');
      submitBtn.textContent = '🔄 재응시';
      renderExamResultView(ex);
      return;
    }

    submitBtn.textContent = '채점·제출';
    activeArea.classList.remove('hidden');
    navFooter.classList.remove('hidden');
    resultArea.classList.add('hidden');

    const q = ex.questions[activeQIdx];
    document.getElementById('examProgressText').textContent = `${activeQIdx + 1} / 50번`;
    document.getElementById('exQNumBadge').textContent = `문항 ${activeQIdx + 1}`;
    document.getElementById('exEraBadge').textContent = q.eraName;
    document.getElementById('exPointsBadge').textContent = `배점 ${q.points}점`;

    const starBtn = document.getElementById('btnBookmarkExamQ');
    const isStarred = !!ex.starred[activeQIdx];
    starBtn.classList.toggle('starred', isStarred);
    starBtn.textContent = isStarred ? '★ 별표됨' : '☆ 별표 체크';

    document.getElementById('exStem').textContent = `${activeQIdx + 1}. ${q.stem}`;
    document.getElementById('exSourceBox').textContent = q.source;

    const listEl = document.getElementById('exChoicesList');
    listEl.innerHTML = '';

    q.choices.forEach((cText, cIdx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isSel = ex.userAnswers[activeQIdx] === cIdx;
      btn.className = `choice-option-btn ${isSel ? 'selected' : ''}`;
      btn.innerHTML = `
        <span class="choice-num-circle">${cIdx + 1}</span>
        <span>${cText}</span>
      `;
      btn.addEventListener('click', () => {
        ex.userAnswers[activeQIdx] = cIdx;
        saveState();
        renderActiveExam();
      });
      listEl.appendChild(btn);
    });

    const nextBtn = document.getElementById('btnExamNext');
    nextBtn.textContent = activeQIdx === 49 ? '🏆 채점·제출하기' : '다음 문제 ▶';

    renderOmrGrid();
  }

  function renderOmrGrid() {
    const ex = getActiveExam();
    const grid = document.getElementById('omrGrid');
    if (!ex || !grid) return;
    grid.innerHTML = '';

    for (let i = 0; i < 50; i++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      const ans = ex.userAnswers[i];
      cell.className = `omr-cell ${ans !== -1 ? 'answered' : ''} ${i === activeQIdx ? 'current' : ''} ${ex.starred[i] ? 'starred' : ''}`;
      cell.textContent = ans !== -1 ? `${i + 1}:${CIRCLE_NUMS[ans]}` : `${i + 1}`;
      cell.addEventListener('click', () => {
        activeQIdx = i;
        document.getElementById('omrDrawer').classList.add('hidden');
        renderActiveExam();
      });
      grid.appendChild(cell);
    }
  }

  document.getElementById('btnBookmarkExamQ').addEventListener('click', () => {
    const ex = getActiveExam();
    if (!ex) return;
    ex.starred[activeQIdx] = !ex.starred[activeQIdx];
    saveState();
    renderActiveExam();
  });

  document.getElementById('btnToggleOmr').addEventListener('click', () => {
    document.getElementById('omrDrawer').classList.toggle('hidden');
    renderOmrGrid();
  });
  document.getElementById('btnExamOmrBottom').addEventListener('click', () => {
    document.getElementById('omrDrawer').classList.toggle('hidden');
    renderOmrGrid();
  });
  document.getElementById('btnCloseOmr').addEventListener('click', () => {
    document.getElementById('omrDrawer').classList.add('hidden');
  });

  document.getElementById('btnExamPrev').addEventListener('click', () => {
    if (activeQIdx > 0) {
      activeQIdx--;
      renderActiveExam();
      document.querySelector('.app-main').scrollTop = 0;
    }
  });

  document.getElementById('btnExamNext').addEventListener('click', () => {
    if (activeQIdx < 49) {
      activeQIdx++;
      renderActiveExam();
      document.querySelector('.app-main').scrollTop = 0;
    } else {
      gradeAndSubmitExam();
    }
  });

  document.getElementById('btnSubmitExam').addEventListener('click', () => {
    const ex = getActiveExam();
    if (!ex) return;
    if (ex.completed) {
      // Reset this exam round to retake
      ex.userAnswers = new Array(50).fill(-1);
      ex.remainSec = 80 * 60;
      ex.completed = false;
      ex.score = null;
      activeQIdx = 0;
      saveState();
      renderActiveExam();
      startExamTimer();
      return;
    }
    gradeAndSubmitExam();
  });

  function gradeAndSubmitExam() {
    const ex = getActiveExam();
    if (!ex) return;
    stopExamTimer();

    let totalScore = 0;
    let correctCnt = 0;

    ex.questions.forEach((q, idx) => {
      const uAns = ex.userAnswers[idx];
      store.solvedCount++;
      if (uAns === q.answer) {
        totalScore += q.points;
        correctCnt++;
        store.correctCount++;
      } else {
        addWrongNote(q, uAns);
      }
    });

    ex.completed = true;
    ex.score = totalScore;
    if (totalScore > store.bestExamScore) {
      store.bestExamScore = totalScore;
    }
    saveState();
    reviewFilter = 'all';
    showToast(`🎉 채점 완료! 총점 ${totalScore}점 (${correctCnt}/50문항 정답)`);
    renderActiveExam();
    document.querySelector('.app-main').scrollTop = 0;
  }

  function renderExamResultView(ex) {
    const s = ex.score || 0;
    const badge = document.getElementById('certGradeBadge');
    const msg = document.getElementById('certSummaryMsg');

    if (s >= 80) {
      badge.textContent = '🏆 제1급 합격! (80점 이상)';
      msg.textContent = '축하합니다! 한국사능력검정시험 심화 1급 기준을 여유 있게 통과하셨습니다.';
    } else if (s >= 70) {
      badge.textContent = '🥈 제2급 합격! (70~79점)';
      msg.textContent = '심화 2급 합격권입니다! 틀린 문제를 복습하면 1급도 충분히 가능합니다.';
    } else if (s >= 60) {
      badge.textContent = '🥉 제3급 합격! (60~69점)';
      msg.textContent = '심화 3급 합격권입니다! 아래 오답 해설을 통해 취약 시대를 보완해 보세요.';
    } else {
      badge.textContent = '💪 아쉽습니다 (60점 미만)';
      msg.textContent = '아래 전 문항 사료 키워드와 오답 해설을 읽으며 개념을 다져 보세요!';
    }

    document.getElementById('certTotalScore').textContent = s;

    // Era Breakdown
    const eraStats = {};
    ex.questions.forEach((q, idx) => {
      if (!eraStats[q.eraName]) eraStats[q.eraName] = { total: 0, ok: 0 };
      eraStats[q.eraName].total++;
      if (ex.userAnswers[idx] === q.answer) eraStats[q.eraName].ok++;
    });

    const eraBox = document.getElementById('certEraBreakdown');
    eraBox.innerHTML = Object.entries(eraStats).map(([eName, st]) => `
      <div class="era-score-chip">
        <span>${eName}</span>
        <strong style="color:${st.ok === st.total ? '#16a34a' : '#1e3a8a'}">${st.ok}/${st.total} 정답</strong>
      </div>
    `).join('');

    // Review list
    const revList = document.getElementById('examReviewList');
    revList.innerHTML = '';

    ex.questions.forEach((q, idx) => {
      const uAns = ex.userAnswers[idx];
      const isOk = uAns === q.answer;
      const isStar = !!ex.starred[idx];

      if (reviewFilter === 'wrong' && isOk) return;
      if (reviewFilter === 'starred' && !isStar) return;

      const card = document.createElement('div');
      card.className = 'question-paper-card';
      const uAnsStr = uAns === -1 ? '미응답' : `${CIRCLE_NUMS[uAns]}번`;

      card.innerHTML = `
        <div class="qp-meta-row">
          <div class="qp-badges">
            <span class="qp-badge qnum">문항 ${idx + 1}</span>
            <span class="qp-badge era">${q.eraName}</span>
            <span class="qp-badge pts">${q.points}점 · ${q.title}</span>
          </div>
          <span style="font-size:0.82rem;font-weight:900;color:${isOk ? '#16a34a' : '#dc2626'}">
            ${isOk ? `⭕ 정답 (${CIRCLE_NUMS[q.answer]})` : `❌ 오답 (내 답: ${uAnsStr} / 정답: ${CIRCLE_NUMS[q.answer]})`}
          </span>
        </div>
        <h3 class="qp-stem">${idx + 1}. ${q.stem}</h3>
        <div class="qp-source-box">${q.source}</div>
        <div class="explanation-panel">
          <div class="exp-keywords-row">
            ${(q.keywords || []).map(k => `<span class="kw-chip">🔑 ${k}</span>`).join('')}
          </div>
          <div class="exp-main-text">${q.explanation}</div>
          <div class="exp-choices-breakdown">
            <h4>🔍 선지별 분석</h4>
            <ul>${(q.choiceDetails || []).map(d => `<li>${d}</li>`).join('')}</ul>
          </div>
        </div>
      `;
      revList.appendChild(card);
    });
  }

  ['btnReviewAll', 'btnReviewWrong', 'btnReviewStarred'].forEach(btnId => {
    document.getElementById(btnId).addEventListener('click', () => {
      document.querySelectorAll('.cert-btn-row .filter-pill').forEach(b => b.classList.remove('active'));
      document.getElementById(btnId).classList.add('active');
      reviewFilter = btnId === 'btnReviewWrong' ? 'wrong' : btnId === 'btnReviewStarred' ? 'starred' : 'all';
      renderExamResultView(getActiveExam());
    });
  });

  // ================= TAB 4: WRONG NOTES & ERA SUMMARY =================
  function addWrongNote(q, chosenIdx) {
    const exists = store.wrongNotes.some(w => w.topicId === q.topicId && w.stem === q.stem);
    if (exists) return;
    store.wrongNotes.unshift({
      ...q,
      chosenIdx,
      savedAt: new Date().toLocaleDateString('ko-KR')
    });
    if (store.wrongNotes.length > 60) store.wrongNotes.pop();
  }

  function renderWrongNotes() {
    const box = document.getElementById('wrongNotesContainer');
    if (!box) return;
    if (store.wrongNotes.length === 0) {
      box.innerHTML = `
        <div class="question-paper-card" style="text-align:center;padding:28px 16px">
          <h3>✨ 아직 저장된 오답이 없습니다!</h3>
          <p style="font-size:0.84rem;color:#64748b;margin-top:6px">50문항 모의고사나 1문제 스피드 풀이에서 틀린 문제가 자동으로 이곳에 정리됩니다.</p>
        </div>
      `;
      return;
    }

    box.innerHTML = '';
    store.wrongNotes.forEach((w, idx) => {
      const card = document.createElement('div');
      card.className = 'question-paper-card';
      card.innerHTML = `
        <div class="qp-meta-row">
          <div class="qp-badges">
            <span class="qp-badge era">${w.eraName}</span>
            <span class="qp-badge pts">${w.title}</span>
          </div>
          <button class="text-close-btn" type="button">삭제 ✕</button>
        </div>
        <h3 class="qp-stem">${w.stem}</h3>
        <div class="qp-source-box">${w.source}</div>
        <div class="explanation-panel">
          <div class="exp-result-banner ok">정답: ${CIRCLE_NUMS[w.answer]} ${w.choices[w.answer]}</div>
          <div class="exp-keywords-row">
            ${(w.keywords || []).map(k => `<span class="kw-chip">🔑 ${k}</span>`).join('')}
          </div>
          <div class="exp-main-text">${w.explanation}</div>
          <div class="exp-choices-breakdown">
            <h4>🔍 선지별 분석</h4>
            <ul>${(w.choiceDetails || []).map(d => `<li>${d}</li>`).join('')}</ul>
          </div>
        </div>
      `;
      card.querySelector('.text-close-btn').addEventListener('click', () => {
        store.wrongNotes.splice(idx, 1);
        saveState();
        renderWrongNotes();
      });
      box.appendChild(card);
    });
  }

  function renderEraSummaries() {
    const box = document.getElementById('eraSummaryContainer');
    if (!box || !window.KHISTORY_ERA_NOTES) return;
    box.innerHTML = window.KHISTORY_ERA_NOTES.map(sec => `
      <div class="summary-era-card">
        <h3>📌 ${sec.name}</h3>
        <ul>
          ${sec.items.map(item => `<li>${item}</li>`).join('')}
        </ul>
      </div>
    `).join('');
  }

  document.getElementById('btnSubtabWrong').addEventListener('click', () => {
    document.getElementById('btnSubtabWrong').classList.add('active');
    document.getElementById('btnSubtabSummary').classList.remove('active');
    document.getElementById('wrongNotesContainer').classList.remove('hidden');
    document.getElementById('eraSummaryContainer').classList.add('hidden');
  });

  document.getElementById('btnSubtabSummary').addEventListener('click', () => {
    document.getElementById('btnSubtabSummary').classList.add('active');
    document.getElementById('btnSubtabWrong').classList.remove('active');
    document.getElementById('eraSummaryContainer').classList.remove('hidden');
    document.getElementById('wrongNotesContainer').classList.add('hidden');
  });

  // ================= MODALS & PWA SETUP =================
  document.getElementById('btnOpenAiModal').addEventListener('click', () => {
    document.getElementById('inputGeminiKey').value = store.geminiKey || '';
    document.getElementById('aiConfigModal').classList.remove('hidden');
  });

  document.getElementById('btnSaveAiKey').addEventListener('click', () => {
    store.geminiKey = document.getElementById('inputGeminiKey').value.trim();
    saveState();
    document.getElementById('aiConfigModal').classList.add('hidden');
    showToast('🤖 AI 설정이 저장되었습니다!');
  });

  document.querySelectorAll('.close-modal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.getAttribute('data-close')).classList.add('hidden');
    });
  });

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  document.getElementById('btnInstallPwa').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    } else {
      document.getElementById('pwaGuideModal').classList.remove('hidden');
    }
  });

  document.getElementById('btnForceRefresh').addEventListener('click', async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
    window.location.reload();
  });

  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
        reg.update();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update();
        });
      }).catch(() => {});
    });
  }

  // Initial render
  renderHomeDashboard();
})();
