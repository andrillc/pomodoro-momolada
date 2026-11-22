// ==========================================================================
// POMODORO - SISTEMA COMPLETO DE FOCO, OFENSIVA E SALAS DE ESTUDO
// ==========================================================================

// --- Configuração Google Sign-In ---
// Insira o Client ID gerado no Google Cloud Console para ativar o login com Google.
// Deixe vazio ('') para desativar o botão de login com Google enquanto não configurado.
const GOOGLE_CLIENT_ID = '';

// --- Estado Global da Aplicação ---
let currentUser = null; // null = Visitante (localStorage); object = Logado (API Cloud)
let currentStreak = null;
let currentRoom = null;
let roomPollingInterval = null;
let heartbeatInterval = null;

let isRunning = false;
let isWorkPeriod = true;
let totalTime = 1500;
let timeLeft = 1500;
let timerId = null;
let expectedEndTime = 0;

let workDurationInput = 25;
let restDurationInput = 5;

// Instanciação da Web Audio API
let audioCtx = null;

// Suite de Frases de Alta Qualidade
const motivationalQuotes = [
  "Grandes feitos são compostos por uma sequência de pequenos passos bem dados.",
  "O foco não é a ausência de distrações, mas a presença de um propósito claro.",
  "A simplicidade e a constância produzem resultados extraordinários.",
  "Proteja o seu tempo de atenção como seu recurso mais precioso.",
  "Continue. O progresso invisível é o que constrói o sucesso visível.",
  "Uma tarefa de cada vez. Uma respiração de cada vez. Presença total.",
  "O minimalismo mental abre espaço para a criatividade fluir livremente.",
];
let currentQuoteIndex = 0;

// Estado das Tarefas (Sincronizado via LocalStorage ou Nuvem)
let todos = [];

// ==========================================================================
// CLIENTE HTTP / API (Com CSRF Header e Credentials Include)
// ==========================================================================
async function apiFetch(endpoint, options = {}) {
  const url = `api/${endpoint}`;
  const config = {
    method: options.method || 'GET',
    headers: {
      'Accept': 'application/json',
      ...(options.headers || {})
    },
    credentials: 'include' // Envia cookie pomodoro_sid Lax
  };

  if (config.method === 'POST') {
    // Cabeçalho de proteção CSRF exigido pelo _bootstrap.php
    config.headers['X-Requested-With'] = 'fetch';

    if (options.body && typeof options.body === 'object') {
      config.headers['Content-Type'] = 'application/json; charset=utf-8';
      config.body = JSON.stringify(options.body);
    } else if (options.body) {
      config.body = options.body;
    }
  }

  try {
    const response = await fetch(url, config);
    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      // Resposta sem corpo JSON
    }

    if (!response.ok) {
      const errMsg = (data && data.error) ? data.error : `Erro na requisição (${response.status})`;
      const error = new Error(errMsg);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (err) {
    throw err;
  }
}

// ==========================================================================
// WEB AUDIO API - SONS PREMIUM
// ==========================================================================
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playTick(intensity) {
  initAudio();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(800 + intensity * 140, audioCtx.currentTime);

  gainNode.gain.setValueAtTime(0.01, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.12 * intensity, audioCtx.currentTime + 0.002);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.04);

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.05);
}

function playCompletionChime(isWorkDone) {
  initAudio();
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const chords = isWorkDone
    ? [523.25, 659.25, 783.99, 1046.5]
    : [440.0, 554.37, 659.25, 880.0];

  chords.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now + idx * 0.07);

    gainNode.gain.setValueAtTime(0.01, now + idx * 0.07);
    gainNode.gain.linearRampToValueAtTime(0.12, now + idx * 0.07 + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.35);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start(now + idx * 0.07);
    osc.stop(now + idx * 0.07 + 0.4);
  });
}

// ==========================================================================
// NOTIFICAÇÕES TOAST
// ==========================================================================
let notificationTimeout = null;
function showNotification(message) {
  const banner = document.getElementById("notification");
  if (!banner) return;
  banner.innerText = message;
  banner.classList.add("show");
  clearTimeout(notificationTimeout);
  notificationTimeout = setTimeout(() => {
    banner.classList.remove("show");
  }, 4000);
}

// ==========================================================================
// PROGRESS RING SVG
// ==========================================================================
const circle = document.querySelector(".progress-ring__circle");
const radius = circle ? circle.r.baseVal.value : 165;
const circumference = radius * 2 * Math.PI;

if (circle) {
  circle.style.strokeDasharray = `${circumference} ${circumference}`;
  circle.style.strokeDashoffset = 0;
}

function setProgress(percent) {
  if (!circle) return;
  const offset = circumference - (percent / 100) * circumference;
  circle.style.strokeDashoffset = offset;
}

// ==========================================================================
// CRONÔMETRO POMODORO & SINCRONIZAÇÃO
// ==========================================================================
function updateDisplay() {
  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;

  const formattedTime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  const countdownEl = document.getElementById("timer-countdown");
  if (countdownEl) countdownEl.innerText = formattedTime;

  const percent = totalTime > 0 ? (timeLeft / totalTime) * 100 : 0;
  setProgress(percent);

  const container = document.getElementById("timer-container");
  if (container) {
    container.classList.remove("state-glow", "state-pulse");
    if (isRunning && isWorkPeriod) {
      if (timeLeft <= 3 && timeLeft > 0) {
        container.classList.add("state-pulse", "state-glow");
      } else if (timeLeft <= 10 && timeLeft > 0) {
        container.classList.add("state-glow");
      }
    }
  }
}

async function handleTick() {
  if (!isRunning) return;

  // Se estivermos em uma sala sincronizada, a atualização de tempo é regida pelo polling/phase_end_at_ms
  if (currentRoom && currentRoom.mode === 'synced') {
    return;
  }

  const now = Date.now();
  timeLeft = Math.round((expectedEndTime - now) / 1000);

  if (timeLeft > 0) {
    if (isWorkPeriod && timeLeft <= 3 && timeLeft >= 1) {
      const intensity = 4 - timeLeft;
      playTick(intensity);
    }
    updateDisplay();
  } else {
    // Sessão concluída
    timeLeft = 0;
    clearInterval(timerId);
    timerId = null;
    isRunning = false;

    if (isWorkPeriod) {
      playCompletionChime(true);
      showNotification("Sessão de foco concluída! Descanse um pouco.");

      // Registra minutos de foco na nuvem se estiver logado
      if (currentUser) {
        logCompletedFocus(workDurationInput);
      }

      isWorkPeriod = false;
      document.getElementById("timer-status").innerText = "DESCANSO";
      totalTime = restDurationInput * 60;
    } else {
      playCompletionChime(false);
      showNotification("Descanso finalizado! Pronto para focar?");
      isWorkPeriod = true;
      document.getElementById("timer-status").innerText = "TRABALHO";
      totalTime = workDurationInput * 60;
    }

    const container = document.getElementById("timer-container");
    if (container) {
      container.style.transform = "scale(0.96)";
      setTimeout(() => { container.style.transform = "scale(1)"; }, 300);
    }

    timeLeft = totalTime;
    updateDisplay();
    resetControlsUI();
  }
}

function resetControlsUI() {
  const btnMain = document.getElementById("btn-main");
  const extraControls = document.getElementById("extra-controls");
  if (btnMain) {
    btnMain.innerText = "INICIAR";
    btnMain.classList.remove("hidden");
  }
  if (extraControls) {
    extraControls.classList.add("hidden");
  }
}

// ==========================================================================
// OFENSIVA ESTILO DUOLINGO (STREAKS & FREEZE REVEAL)
// ==========================================================================
function updateStreakUI(streak) {
  if (!streak) return;
  currentStreak = streak;

  const countEl = document.getElementById("streak-count");
  const freezeIcon = document.getElementById("streak-freeze-icon");

  if (countEl) countEl.innerText = streak.current_streak || 0;

  if (freezeIcon) {
    // Se o usuário possui bloqueio revelado (> 0)
    if (streak.streak_freezes && streak.streak_freezes > 0) {
      freezeIcon.classList.remove("hidden");
    } else {
      freezeIcon.classList.add("hidden");
    }
  }

  // Verifica se há desbloqueio surpresa pendente de revelação
  if (streak.freeze_reveal_pending) {
    triggerFreezeRevealModal();
  }
}

async function logCompletedFocus(minutes) {
  try {
    const res = await apiFetch('streaks.php?action=log_focus', {
      method: 'POST',
      body: {
        duration_minutes: minutes,
        room_id: currentRoom ? currentRoom.id : null
      }
    });
    if (res && res.streak) {
      updateStreakUI(res.streak);
      if (res.streak.goal_met_today) {
        showNotification("🔥 Meta diária de foco batida! Ofensiva mantida!");
      }
    }
  } catch (err) {
    console.warn("Não foi possível sincronizar ciclo de foco:", err.message);
  }
}

function triggerFreezeRevealModal() {
  const modal = document.getElementById("freeze-reveal-modal");
  if (modal) modal.classList.remove("hidden");
}

async function claimFreezeReveal() {
  const modal = document.getElementById("freeze-reveal-modal");
  if (modal) modal.classList.add("hidden");

  try {
    const res = await apiFetch('streaks.php?action=reveal_freeze', { method: 'POST' });
    if (res && res.streak) {
      updateStreakUI(res.streak);
      showNotification("🧊 Bloqueio de ofensiva equipado com sucesso!");
    }
  } catch (err) {
    console.warn("Erro ao revelar bloqueio:", err.message);
  }
}

// ==========================================================================
// TAREFAS (MISSÕES) - LOCALSTORAGE & NUVEM
// ==========================================================================
async function loadTodos() {
  if (currentUser) {
    try {
      const res = await apiFetch('tasks.php?action=list');
      if (res && res.tasks) {
        todos = res.tasks.map(t => ({
          id: String(t.id),
          text: t.title,
          completed: !!t.is_completed,
          priority: t.priority || 'medium'
        }));
      }
    } catch (err) {
      console.warn("Erro ao buscar tarefas da nuvem, mantendo locais:", err.message);
      todos = JSON.parse(localStorage.getItem("focus_todos")) || [];
    }
  } else {
    // Modo Visitante
    todos = JSON.parse(localStorage.getItem("focus_todos")) || [
      {
        id: "1",
        text: "Aqui você pode definir uma tarefa e organizar por prioridade movendo elas",
        completed: false,
        priority: "high",
      },
    ];
  }
  renderTodos();
}

function saveLocalTodos() {
  localStorage.setItem("focus_todos", JSON.stringify(todos));
}

function renderTodos() {
  const listContainer = document.getElementById("todo-list");
  if (!listContainer) return;
  listContainer.innerHTML = "";

  todos.forEach((todo) => {
    const li = document.createElement("li");
    li.className = `todo-item ${todo.completed ? "completed" : ""}`;
    li.setAttribute("draggable", "true");
    li.setAttribute("data-id", todo.id);

    li.innerHTML = `
      <span class="priority-dot p-${todo.priority || "medium"}" title="Clique para mudar a prioridade"></span>
      <div class="checkbox-custom"></div>
      <div class="todo-text" contenteditable="true">${escapeHtml(todo.text)}</div>
      <button class="todo-delete-btn" title="Excluir tarefa">&times;</button>
    `;

    li.querySelector(".checkbox-custom").addEventListener("click", () => toggleTodo(todo.id));
    li.querySelector(".priority-dot").addEventListener("click", () => cyclePriority(todo.id));

    const textEl = li.querySelector(".todo-text");
    textEl.addEventListener("blur", () => {
      const newText = textEl.innerText.trim();
      if (newText !== todo.text) {
        updateTodoText(todo.id, newText);
      }
    });

    li.querySelector(".todo-delete-btn").addEventListener("click", () => deleteTodo(todo.id));

    li.addEventListener("dragstart", handleDragStart);
    li.addEventListener("dragover", handleDragOver);
    li.addEventListener("drop", handleDrop);
    li.addEventListener("dragend", handleDragEnd);

    listContainer.appendChild(li);
  });
}

async function addTodo(text) {
  if (!text.trim()) return;

  if (currentUser) {
    try {
      const res = await apiFetch('tasks.php?action=create', {
        method: 'POST',
        body: { title: text.trim(), priority: 'medium' }
      });
      if (res && res.task) {
        todos.push({
          id: String(res.task.id),
          text: res.task.title,
          completed: !!res.task.is_completed,
          priority: res.task.priority
        });
        renderTodos();
      }
    } catch (err) {
      showNotification("Erro ao salvar tarefa: " + err.message);
    }
  } else {
    // Visitante
    const newTodo = {
      id: Date.now().toString(),
      text: text.trim(),
      completed: false,
      priority: "medium",
    };
    todos.push(newTodo);
    saveLocalTodos();
    renderTodos();
  }
}

async function toggleTodo(id) {
  const item = todos.find(t => t.id === id);
  if (!item) return;
  item.completed = !item.completed;
  renderTodos();

  if (currentUser) {
    try {
      await apiFetch('tasks.php?action=toggle', { method: 'POST', body: { id: Number(id) } });
    } catch (err) {
      console.warn("Erro ao alternar conclusão:", err.message);
    }
  } else {
    saveLocalTodos();
  }
}

async function cyclePriority(id) {
  const pLevels = ["low", "medium", "high"];
  const item = todos.find(t => t.id === id);
  if (!item) return;

  const nextIdx = (pLevels.indexOf(item.priority || "medium") + 1) % pLevels.length;
  item.priority = pLevels[nextIdx];
  renderTodos();

  if (currentUser) {
    try {
      await apiFetch('tasks.php?action=priority', {
        method: 'POST',
        body: { id: Number(id), priority: item.priority }
      });
    } catch (err) {
      console.warn("Erro ao alterar prioridade:", err.message);
    }
  } else {
    saveLocalTodos();
  }
}

async function updateTodoText(id, newText) {
  const item = todos.find(t => t.id === id);
  if (!item) return;
  item.text = newText;

  if (currentUser) {
    try {
      await apiFetch('tasks.php?action=update', {
        method: 'POST',
        body: { id: Number(id), title: newText }
      });
    } catch (err) {
      console.warn("Erro ao atualizar texto da tarefa:", err.message);
    }
  } else {
    saveLocalTodos();
  }
}

async function deleteTodo(id) {
  todos = todos.filter(t => t.id !== id);
  renderTodos();

  if (currentUser) {
    try {
      await apiFetch('tasks.php?action=delete', { method: 'POST', body: { id: Number(id) } });
    } catch (err) {
      console.warn("Erro ao deletar tarefa:", err.message);
    }
  } else {
    saveLocalTodos();
  }
}

// Drag & Drop
let dragSourceElement = null;

function handleDragStart(e) {
  dragSourceElement = this;
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", this.getAttribute("data-id"));
}

function handleDragOver(e) {
  e.preventDefault();
  return false;
}

async function handleDrop(e) {
  e.stopPropagation();
  e.preventDefault();
  const targetId = this.getAttribute("data-id");
  const sourceId = e.dataTransfer.getData("text/plain");

  if (sourceId !== targetId) {
    const sourceIdx = todos.findIndex((t) => t.id === sourceId);
    const targetIdx = todos.findIndex((t) => t.id === targetId);

    const [movedItem] = todos.splice(sourceIdx, 1);
    todos.splice(targetIdx, 0, movedItem);

    renderTodos();

    if (currentUser) {
      try {
        await apiFetch('tasks.php?action=reorder', {
          method: 'POST',
          body: { ids: todos.map(t => Number(t.id)) }
        });
      } catch (err) {
        console.warn("Erro ao reordenar tarefas na nuvem:", err.message);
      }
    } else {
      saveLocalTodos();
    }
  }
}

function handleDragEnd() {
  this.classList.remove("dragging");
}

// ==========================================================================
// AUTENTICAÇÃO E PERFIL (LOGIN, CADASTRO, GOOGLE, ATUALIZAÇÃO)
// ==========================================================================
async function checkAuthStatus() {
  try {
    const res = await apiFetch('auth_login.php?action=me');
    if (res && res.user) {
      setAuthenticatedUser(res.user, res.streak);
    } else {
      setGuestMode();
    }
  } catch (err) {
    // Caso offline ou sem banco, mantém visitante silenciosamente
    setGuestMode();
  }
}

function setAuthenticatedUser(user, streak) {
  currentUser = user;
  updateAuthUI();

  // Sincroniza personalizações do usuário
  const userTitle = (user.pomodoro_title && user.pomodoro_title.trim() !== '') ? user.pomodoro_title : 'Pomodoro';
  const brandEl = document.getElementById("brand-logo");
  if (brandEl) brandEl.innerText = userTitle;
  document.title = userTitle;

  // Aplica tema de forma robusta e segura
  if (user.theme && VALID_THEMES.includes(user.theme)) {
    applyTheme(user.theme, false);
  } else {
    // Se o tema no banco for 'default' ou vazio, aplica o tema padrão 'clean-white' e salva na conta
    const currentTheme = localStorage.getItem("focus_theme") || "clean-white";
    applyTheme(currentTheme, true);
  }

  if (user.focus_minutes && !isRunning) {
    workDurationInput = user.focus_minutes;
    document.getElementById("work-time-input").value = user.focus_minutes;
    if (isWorkPeriod) {
      totalTime = workDurationInput * 60;
      timeLeft = totalTime;
    }
  }
  if (user.break_minutes && !isRunning) {
    restDurationInput = user.break_minutes;
    document.getElementById("rest-time-input").value = user.break_minutes;
    if (!isWorkPeriod) {
      totalTime = restDurationInput * 60;
      timeLeft = totalTime;
    }
  }
  updateDisplay();

  // Atualiza ofensiva
  if (streak) {
    updateStreakUI(streak);
  }

  // Atualiza tarefas da nuvem
  loadTodos();

  // Inicia loop de presença
  startHeartbeat();

  // Checa notificações pendentes
  checkPendingBadges();
}

function setGuestMode() {
  currentUser = null;
  updateAuthUI();
  const brandEl = document.getElementById("brand-logo");
  if (brandEl) brandEl.innerText = "Pomodoro";
  document.title = "Pomodoro";
  stopHeartbeat();
  loadTodos();
}

function updateAuthUI() {
  const authBtnLabel = document.getElementById("auth-btn-label");
  const cloudSyncStatus = document.getElementById("cloud-sync-status");
  const adminBtn = document.getElementById("admin-btn");
  const guestView = document.getElementById("auth-guest-view");
  const loggedView = document.getElementById("auth-logged-view");
  const modalTitle = document.getElementById("auth-modal-title");

  if (currentUser) {
    if (modalTitle) modalTitle.innerText = "Meu Perfil";
    if (authBtnLabel) {
      authBtnLabel.innerText = currentUser.display_name || currentUser.username;
    }
    if (cloudSyncStatus) {
      cloudSyncStatus.innerText = "☁️ Nuvem";
      cloudSyncStatus.title = "Tarefas salvas na sua conta";
    }

    // Exibe botão de Admin se is_admin == 1
    if (adminBtn) {
      if (currentUser.is_admin) {
        adminBtn.classList.remove("hidden");
      } else {
        adminBtn.classList.add("hidden");
      }
    }

    if (guestView) guestView.classList.add("hidden");
    if (loggedView) loggedView.classList.remove("hidden");

    // Popula campos de perfil
    const nameDisplay = document.getElementById("profile-name-display");
    const userHandle = document.getElementById("profile-user-handle");
    const planBadge = document.getElementById("profile-plan-badge");
    const titleInput = document.getElementById("profile-title-input");
    const displayInput = document.getElementById("profile-display-input");
    const focusInput = document.getElementById("profile-focus-input");
    const breakInput = document.getElementById("profile-break-input");
    const goalInput = document.getElementById("profile-goal-input");

    if (nameDisplay) nameDisplay.innerText = currentUser.display_name;
    if (userHandle) userHandle.innerText = "@" + currentUser.username;
    if (planBadge) planBadge.innerText = (currentUser.plan_type || "free").toUpperCase();

    if (titleInput) titleInput.value = currentUser.pomodoro_title || "Pomodoro";
    if (displayInput) displayInput.value = currentUser.display_name || "";
    if (focusInput) focusInput.value = currentUser.focus_minutes || 25;
    if (breakInput) breakInput.value = currentUser.break_minutes || 5;
    if (goalInput && currentStreak) goalInput.value = currentStreak.daily_goal_minutes || 25;
  } else {
    if (modalTitle) {
      const tabRegister = document.getElementById("tab-btn-register");
      const isRegisterActive = tabRegister && tabRegister.classList.contains("active");
      modalTitle.innerText = isRegisterActive ? "Criar Nova Conta" : "Entrar na sua Conta";
    }
    if (authBtnLabel) authBtnLabel.innerText = "Entrar";
    if (cloudSyncStatus) {
      cloudSyncStatus.innerText = "💻 Local";
      cloudSyncStatus.title = "Modo visitante (tarefas salvas no navegador)";
    }
    if (adminBtn) adminBtn.classList.add("hidden");

    if (guestView) guestView.classList.remove("hidden");
    if (loggedView) loggedView.classList.add("hidden");
  }
}

// Formulário de Login
async function handleLogin(e) {
  e.preventDefault();
  const ident = document.getElementById("login-ident").value.trim();
  const pass = document.getElementById("login-pass").value;

  try {
    const res = await apiFetch('auth_login.php?action=login', {
      method: 'POST',
      body: { login: ident, password: pass }
    });
    if (res && res.user) {
      setAuthenticatedUser(res.user, null);
      closeAllModals();
      showNotification(`Bem-vindo de volta, ${res.user.display_name}!`);
      // Busca streak atualizado
      const sRes = await apiFetch('streaks.php?action=get');
      if (sRes && sRes.streak) updateStreakUI(sRes.streak);
    }
  } catch (err) {
    showNotification(err.message);
  }
}

// Formulário de Cadastro
async function handleRegister(e) {
  e.preventDefault();
  const email = document.getElementById("reg-email").value.trim();
  const username = document.getElementById("reg-username").value.trim();
  const display = document.getElementById("reg-display").value.trim();
  const pass = document.getElementById("reg-pass").value;

  try {
    const res = await apiFetch('auth_login.php?action=register', {
      method: 'POST',
      body: { email, username, display_name: display, password: pass }
    });
    if (res && res.user) {
      setAuthenticatedUser(res.user, null);
      closeAllModals();
      showNotification(`Conta criada com sucesso! Olá, ${res.user.display_name}!`);
      const sRes = await apiFetch('streaks.php?action=get');
      if (sRes && sRes.streak) updateStreakUI(sRes.streak);
    }
  } catch (err) {
    showNotification(err.message);
  }
}

// Atualização de Perfil
async function handleUpdateProfile(e) {
  e.preventDefault();
  const rawTitle = document.getElementById("profile-title-input").value.trim();
  const pomodoroTitle = rawTitle || 'Pomodoro'; // Evita erro de título vazio na API
  const displayName = document.getElementById("profile-display-input").value.trim();
  const focusMin = parseInt(document.getElementById("profile-focus-input").value) || 25;
  const breakMin = parseInt(document.getElementById("profile-break-input").value) || 5;
  const goalMin = parseInt(document.getElementById("profile-goal-input").value) || 25;

  try {
    const res = await apiFetch('auth_login.php?action=update_profile', {
      method: 'POST',
      body: {
        pomodoro_title: pomodoroTitle,
        display_name: displayName || (currentUser ? currentUser.username : 'Estudante'),
        focus_minutes: focusMin,
        break_minutes: breakMin
      }
    });

    if (res && res.user) {
      currentUser = res.user;
      const updatedTitle = currentUser.pomodoro_title || 'Pomodoro';
      document.getElementById("brand-logo").innerText = updatedTitle;
      document.title = updatedTitle;
      workDurationInput = currentUser.focus_minutes;
      restDurationInput = currentUser.break_minutes;
      document.getElementById("work-time-input").value = workDurationInput;
      document.getElementById("rest-time-input").value = restDurationInput;
      if (!isRunning) {
        totalTime = (isWorkPeriod ? workDurationInput : restDurationInput) * 60;
        timeLeft = totalTime;
        updateDisplay();
      }
    }

    // Atualiza meta diária
    if (goalMin > 0) {
      const gRes = await apiFetch('streaks.php?action=set_goal', {
        method: 'POST',
        body: { daily_goal_minutes: goalMin }
      });
      if (gRes && gRes.streak) updateStreakUI(gRes.streak);
    }

    closeAllModals();
    showNotification("Alterações salvas com sucesso!");
  } catch (err) {
    showNotification(err.message);
  }
}

// Logout
async function handleLogout() {
  try {
    await apiFetch('auth_login.php?action=logout', { method: 'POST' });
  } catch (err) {
    console.warn("Erro ao deslogar:", err.message);
  }
  setGuestMode();
  closeAllModals();
  showNotification("Você saiu da conta. Modo visitante ativo.");
}

// Configuração Google Sign-In
function initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.trim() === '') {
    // Não renderiza botão do Google se a constante estiver vazia
    return;
  }

  const wrapper = document.getElementById("google-auth-wrapper");
  if (wrapper) wrapper.classList.remove("hidden");

  // Injeta script do Google sob demanda
  if (!document.getElementById("google-gsi-script")) {
    const script = document.createElement("script");
    script.id = "google-gsi-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      renderGoogleButton();
    };
    document.body.appendChild(script);
  } else {
    renderGoogleButton();
  }
}

function renderGoogleButton() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) return;

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredentialResponse
  });

  const container = document.getElementById("google-signin-btn-container");
  if (container) {
    container.innerHTML = "";
    google.accounts.id.renderButton(container, {
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "pill"
    });
  }
}

async function handleGoogleCredentialResponse(response) {
  if (!response || !response.credential) return;

  try {
    const res = await apiFetch('auth_google.php', {
      method: 'POST',
      body: { credential: response.credential }
    });
    if (res && res.user) {
      setAuthenticatedUser(res.user, res.streak);
      closeAllModals();
      showNotification(`Conectado com Google! Olá, ${res.user.display_name}!`);
    }
  } catch (err) {
    showNotification("Erro no login com Google: " + err.message);
  }
}

// ==========================================================================
// PRESENÇA E HEARTBEAT
// ==========================================================================
function startHeartbeat() {
  stopHeartbeat();
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, 45000); // Heartbeat a cada 45s
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

async function sendHeartbeat() {
  if (!currentUser) return;
  const status = isRunning ? (isWorkPeriod ? 'focusing' : 'break') : 'online';
  try {
    await apiFetch('auth_login.php?action=heartbeat', {
      method: 'POST',
      body: { status }
    });
  } catch (err) {
    // Falha silenciosa de presença
  }
}

// ==========================================================================
// AMIGOS E IMPULSO DIÁRIO (FRIENDS & STREAK BOOST)
// ==========================================================================
async function openFriendsDrawer() {
  if (!currentUser) {
    openAuthModal();
    showNotification("Faça login para interagir com seus amigos!");
    return;
  }
  document.getElementById("friends-sidebar").classList.add("open");
  loadFriendsList();
  loadFriendRequests();
}

async function loadFriendsList() {
  try {
    const res = await apiFetch('friends.php?action=list');
    const ul = document.getElementById("friends-ul");
    const emptyMsg = document.getElementById("friends-empty-msg");
    if (!ul) return;
    ul.innerHTML = "";

    if (!res || !res.friends || res.friends.length === 0) {
      if (emptyMsg) emptyMsg.classList.remove("hidden");
      return;
    }
    if (emptyMsg) emptyMsg.classList.add("hidden");

    res.friends.forEach(f => {
      const li = document.createElement("li");
      li.className = "social-user-item";

      const presenceClass = `p-${f.presence || 'offline'}`;
      const presenceTitle = f.presence === 'focusing' ? 'Estudando' : (f.presence === 'break' ? 'Em pausa' : f.presence);
      const isBoosted = !!f.boosted_today;

      li.innerHTML = `
        <div class="social-user-meta">
          <div class="user-avatar-wrap">
            ${f.avatar_url ? `<img src="${escapeHtml(f.avatar_url)}" class="user-avatar-img">` : '👤'}
            <span class="presence-status-dot ${presenceClass}" title="${presenceTitle}"></span>
          </div>
          <div class="social-user-info">
            <span class="social-user-name">${escapeHtml(f.display_name)}</span>
            <span class="social-user-sub">@${escapeHtml(f.username)} • 🔥 ${f.current_streak || 0} dias</span>
          </div>
        </div>
        <div class="social-actions">
          <button class="btn-sm btn-sm-fire ${isBoosted ? 'boosted' : ''}" data-id="${f.id}" ${isBoosted ? 'disabled' : ''} title="Enviar impulso diário de ofensiva">
            ${isBoosted ? '✓ Impulsionado' : '🔥 Impulso'}
          </button>
        </div>
      `;

      const boostBtn = li.querySelector(".btn-sm-fire");
      if (boostBtn && !isBoosted) {
        boostBtn.addEventListener("click", () => sendStreakBoost(f.id, f.display_name, boostBtn));
      }

      ul.appendChild(li);
    });
  } catch (err) {
    console.warn("Erro ao carregar amigos:", err.message);
  }
}

async function sendStreakBoost(friendId, friendName, btnEl) {
  try {
    await apiFetch('streaks.php?action=boost', {
      method: 'POST',
      body: { friend_id: friendId }
    });
    btnEl.disabled = true;
    btnEl.innerText = "✓ Impulsionado";
    showNotification(`🔥 Você enviou um impulso de ofensiva para ${friendName}!`);
  } catch (err) {
    showNotification(err.message);
  }
}

let searchDebounceTimeout = null;
function handleFriendSearch(e) {
  clearTimeout(searchDebounceTimeout);
  const q = e.target.value.trim();
  if (q.length < 2) {
    document.getElementById("friend-search-results").innerHTML = "";
    return;
  }

  searchDebounceTimeout = setTimeout(async () => {
    try {
      const res = await apiFetch(`friends.php?action=search&q=${encodeURIComponent(q)}`);
      const ul = document.getElementById("friend-search-results");
      ul.innerHTML = "";

      if (!res || !res.users || res.users.length === 0) {
        ul.innerHTML = '<li class="social-empty-msg">Nenhum usuário encontrado.</li>';
        return;
      }

      res.users.forEach(u => {
        const li = document.createElement("li");
        li.className = "social-user-item";

        let actionBtnHtml = '';
        if (u.relation === 'none') {
          actionBtnHtml = `<button class="btn-sm btn-add-friend" data-id="${u.id}">+ Adicionar</button>`;
        } else if (u.relation === 'sent') {
          actionBtnHtml = `<span class="social-user-sub">Solicitado</span>`;
        } else if (u.relation === 'received') {
          actionBtnHtml = `<button class="btn-sm btn-accept-friend" data-id="${u.id}">Aceitar</button>`;
        } else {
          actionBtnHtml = `<span class="social-user-sub">Amigos</span>`;
        }

        li.innerHTML = `
          <div class="social-user-meta">
            <div class="user-avatar-wrap">
              ${u.avatar_url ? `<img src="${escapeHtml(u.avatar_url)}" class="user-avatar-img">` : '👤'}
            </div>
            <div class="social-user-info">
              <span class="social-user-name">${escapeHtml(u.display_name)}</span>
              <span class="social-user-sub">@${escapeHtml(u.username)}</span>
            </div>
          </div>
          <div class="social-actions">${actionBtnHtml}</div>
        `;

        const addBtn = li.querySelector(".btn-add-friend");
        if (addBtn) {
          addBtn.addEventListener("click", () => requestFriendship(u.id, li));
        }
        const accBtn = li.querySelector(".btn-accept-friend");
        if (accBtn) {
          accBtn.addEventListener("click", () => requestFriendship(u.id, li));
        }

        ul.appendChild(li);
      });
    } catch (err) {
      console.warn("Erro ao buscar amigos:", err.message);
    }
  }, 300);
}

async function requestFriendship(userId, itemEl) {
  try {
    const res = await apiFetch('friends.php?action=request', {
      method: 'POST',
      body: { user_id: userId }
    });
    showNotification(res.status === 'accepted' ? "Agora vocês são amigos!" : "Solicitação enviada!");
    if (itemEl) {
      const actions = itemEl.querySelector(".social-actions");
      if (actions) actions.innerHTML = `<span class="social-user-sub">${res.status === 'accepted' ? 'Amigos' : 'Solicitado'}</span>`;
    }
  } catch (err) {
    showNotification(err.message);
  }
}

async function loadFriendRequests() {
  try {
    const res = await apiFetch('friends.php?action=pending');
    const incomingUl = document.getElementById("incoming-requests-list");
    const outgoingUl = document.getElementById("outgoing-requests-list");
    const badge = document.getElementById("requests-badge-count");
    const friendsNavBadge = document.getElementById("friends-badge");

    if (incomingUl) incomingUl.innerHTML = "";
    if (outgoingUl) outgoingUl.innerHTML = "";

    const incomingCount = (res && res.incoming) ? res.incoming.length : 0;

    if (badge) {
      if (incomingCount > 0) {
        badge.innerText = incomingCount;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }

    if (friendsNavBadge) {
      if (incomingCount > 0) friendsNavBadge.classList.remove("hidden");
      else friendsNavBadge.classList.add("hidden");
    }

    if (res && res.incoming && res.incoming.length > 0) {
      res.incoming.forEach(req => {
        const li = document.createElement("li");
        li.className = "social-user-item";
        li.innerHTML = `
          <div class="social-user-meta">
            <div class="user-avatar-wrap">${req.avatar_url ? `<img src="${escapeHtml(req.avatar_url)}" class="user-avatar-img">` : '👤'}</div>
            <div class="social-user-info">
              <span class="social-user-name">${escapeHtml(req.display_name)}</span>
              <span class="social-user-sub">@${escapeHtml(req.username)}</span>
            </div>
          </div>
          <div class="social-actions">
            <button class="btn-sm btn-accept" data-fid="${req.friendship_id}">Aceitar</button>
            <button class="btn-sm btn-reject" data-fid="${req.friendship_id}">Recusar</button>
          </div>
        `;

        li.querySelector(".btn-accept").addEventListener("click", () => respondFriendship(req.friendship_id, true));
        li.querySelector(".btn-reject").addEventListener("click", () => respondFriendship(req.friendship_id, false));
        incomingUl.appendChild(li);
      });
    } else if (incomingUl) {
      incomingUl.innerHTML = '<li class="social-empty-msg">Nenhuma solicitação recebida.</li>';
    }

    if (res && res.outgoing && res.outgoing.length > 0) {
      res.outgoing.forEach(req => {
        const li = document.createElement("li");
        li.className = "social-user-item";
        li.innerHTML = `
          <div class="social-user-meta">
            <div class="user-avatar-wrap">${req.avatar_url ? `<img src="${escapeHtml(req.avatar_url)}" class="user-avatar-img">` : '👤'}</div>
            <div class="social-user-info">
              <span class="social-user-name">${escapeHtml(req.display_name)}</span>
              <span class="social-user-sub">@${escapeHtml(req.username)}</span>
            </div>
          </div>
          <div class="social-actions"><span class="social-user-sub">Pendente</span></div>
        `;
        outgoingUl.appendChild(li);
      });
    } else if (outgoingUl) {
      outgoingUl.innerHTML = '<li class="social-empty-msg">Nenhuma solicitação enviada.</li>';
    }
  } catch (err) {
    console.warn("Erro ao carregar solicitações:", err.message);
  }
}

async function respondFriendship(friendshipId, accept) {
  try {
    await apiFetch('friends.php?action=respond', {
      method: 'POST',
      body: { friendship_id: friendshipId, accept: accept }
    });
    showNotification(accept ? "Amizade aceita!" : "Solicitação recusada.");
    loadFriendRequests();
    loadFriendsList();
  } catch (err) {
    showNotification(err.message);
  }
}

async function checkPendingBadges() {
  if (!currentUser) return;
  try {
    const fRes = await apiFetch('friends.php?action=pending');
    const fBadge = document.getElementById("friends-badge");
    if (fBadge) {
      if (fRes && fRes.incoming && fRes.incoming.length > 0) {
        fBadge.classList.remove("hidden");
      } else {
        fBadge.classList.add("hidden");
      }
    }

    const rRes = await apiFetch('rooms.php?action=invitations');
    const rBadge = document.getElementById("rooms-badge");
    if (rBadge) {
      if (rRes && rRes.invitations && rRes.invitations.length > 0) {
        rBadge.classList.remove("hidden");
      } else {
        rBadge.classList.add("hidden");
      }
    }
  } catch (err) {
    // Falha silenciosa
  }
}

// ==========================================================================
// SALAS DE ESTUDO (STUDY ROOMS)
// ==========================================================================
async function openRoomsModal() {
  if (!currentUser) {
    openAuthModal();
    showNotification("Faça login para criar ou participar de salas de estudo!");
    return;
  }
  document.getElementById("rooms-modal").classList.remove("hidden");
  populateRoomFriendSelect();
  loadRoomInvitations();
  loadActiveRooms();
}

async function populateRoomFriendSelect() {
  const select = document.getElementById("room-friend-select");
  if (!select) return;
  select.innerHTML = '<option value="">Carregando amigos...</option>';

  try {
    const res = await apiFetch('friends.php?action=list');
    select.innerHTML = '<option value="">Selecione um amigo...</option>';
    if (res && res.friends && res.friends.length > 0) {
      res.friends.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.innerText = `${f.display_name} (@${f.username})`;
        select.appendChild(opt);
      });
    } else {
      select.innerHTML = '<option value="">Nenhum amigo disponível (adicione amigos antes)</option>';
    }
  } catch (err) {
    select.innerHTML = '<option value="">Erro ao carregar amigos</option>';
  }
}

async function handleCreateRoom(e) {
  e.preventDefault();
  const friendId = parseInt(document.getElementById("room-friend-select").value);
  const mode = document.getElementById("room-mode-select").value;

  if (!friendId) {
    showNotification("Por favor, selecione um amigo para a sala.");
    return;
  }

  try {
    const res = await apiFetch('rooms.php?action=create', {
      method: 'POST',
      body: { friend_id: friendId, mode: mode }
    });
    if (res && res.room) {
      closeAllModals();
      connectToRoom(res.room);
      showNotification("Sala de estudo criada! Convite enviado.");
    }
  } catch (err) {
    showNotification(err.message);
  }
}

async function loadRoomInvitations() {
  try {
    const res = await apiFetch('rooms.php?action=invitations');
    const sec = document.getElementById("rooms-invites-section");
    const ul = document.getElementById("rooms-invites-list");
    if (!sec || !ul) return;
    ul.innerHTML = "";

    if (!res || !res.invitations || res.invitations.length === 0) {
      sec.classList.add("hidden");
      return;
    }

    sec.classList.remove("hidden");
    res.invitations.forEach(inv => {
      const li = document.createElement("li");
      li.className = "social-user-item";
      li.innerHTML = `
        <div class="social-user-meta">
          <div class="user-avatar-wrap">${inv.avatar_url ? `<img src="${escapeHtml(inv.avatar_url)}" class="user-avatar-img">` : '👥'}</div>
          <div class="social-user-info">
            <span class="social-user-name">${escapeHtml(inv.display_name)} te convidou</span>
            <span class="social-user-sub">Modo: ${inv.mode === 'synced' ? 'Sincronizado' : 'Independente'}</span>
          </div>
        </div>
        <div class="social-actions">
          <button class="btn-sm btn-accept" data-rid="${inv.room_id}">Entrar</button>
          <button class="btn-sm btn-reject" data-rid="${inv.room_id}">Recusar</button>
        </div>
      `;

      li.querySelector(".btn-accept").addEventListener("click", () => respondRoomInvitation(inv.room_id, true));
      li.querySelector(".btn-reject").addEventListener("click", () => respondRoomInvitation(inv.room_id, false));
      ul.appendChild(li);
    });
  } catch (err) {
    console.warn("Erro ao carregar convites de salas:", err.message);
  }
}

async function respondRoomInvitation(roomId, accept) {
  try {
    const res = await apiFetch('rooms.php?action=respond', {
      method: 'POST',
      body: { room_id: roomId, accept: accept }
    });
    if (accept && res && res.room) {
      closeAllModals();
      connectToRoom(res.room);
      showNotification("Você entrou na sala de estudo!");
    } else {
      showNotification("Convite recusado.");
      loadRoomInvitations();
    }
  } catch (err) {
    showNotification(err.message);
  }
}

async function loadActiveRooms() {
  try {
    const res = await apiFetch('rooms.php?action=list');
    const ul = document.getElementById("active-rooms-list");
    const emptyMsg = document.getElementById("rooms-empty-msg");
    if (!ul) return;
    ul.innerHTML = "";

    if (!res || !res.rooms || res.rooms.length === 0) {
      if (emptyMsg) emptyMsg.classList.remove("hidden");
      return;
    }
    if (emptyMsg) emptyMsg.classList.add("hidden");

    res.rooms.forEach(r => {
      const li = document.createElement("li");
      li.className = "social-user-item";
      li.innerHTML = `
        <div class="social-user-meta">
          <div class="user-avatar-wrap">📚</div>
          <div class="social-user-info">
            <span class="social-user-name">Sala de ${escapeHtml(r.host_name)}</span>
            <span class="social-user-sub">${r.mode === 'synced' ? 'Sincronizado' : 'Independente'} • Status: ${r.timer_state}</span>
          </div>
        </div>
        <div class="social-actions">
          <button class="btn-sm btn-reconnect" data-rid="${r.id}">Conectar</button>
        </div>
      `;

      li.querySelector(".btn-reconnect").addEventListener("click", async () => {
        try {
          const roomRes = await apiFetch(`rooms.php?action=get&room_id=${r.id}`);
          if (roomRes && roomRes.room) {
            closeAllModals();
            connectToRoom(roomRes.room);
          }
        } catch (err) {
          showNotification(err.message);
        }
      });
      ul.appendChild(li);
    });
  } catch (err) {
    console.warn("Erro ao listar salas ativas:", err.message);
  }
}

function connectToRoom(room) {
  currentRoom = room;
  renderActiveRoomBanner(room);

  // Inicia Polling leve de sincronização da sala a cada 3.5 segundos
  if (roomPollingInterval) clearInterval(roomPollingInterval);
  roomPollingInterval = setInterval(syncRoomState, 3500);

  syncRoomState();
}

function renderActiveRoomBanner(room) {
  const banner = document.getElementById("active-room-banner");
  if (!banner) return;

  const textEl = document.getElementById("room-banner-text");
  const modeTag = document.getElementById("room-mode-tag");
  const membersEl = document.getElementById("room-members-count");

  if (textEl) {
    const hostMember = room.members.find(m => m.is_host);
    textEl.innerText = `Sala: ${hostMember ? hostMember.display_name : 'Estudo'}`;
  }
  if (modeTag) {
    modeTag.innerText = room.mode === 'synced' ? 'Sincronizado' : 'Independente';
  }
  if (membersEl) {
    membersEl.innerText = `👥 ${room.members ? room.members.length : 1}`;
  }

  banner.classList.remove("hidden");
}

async function syncRoomState() {
  if (!currentRoom) return;

  try {
    const res = await apiFetch(`rooms.php?action=get&room_id=${currentRoom.id}`);
    if (!res || !res.room) return;
    const r = res.room;
    currentRoom = r;
    renderActiveRoomBanner(r);

    if (r.mode === 'synced') {
      // Sincroniza o cronômetro local com o servidor
      isWorkPeriod = (r.timer_phase === 'focus');
      document.getElementById("timer-status").innerText = isWorkPeriod ? "TRABALHO" : "DESCANSO";

      if (r.timer_state === 'running') {
        isRunning = true;
        document.getElementById("btn-main").classList.add("hidden");
        document.getElementById("extra-controls").classList.remove("hidden");
        document.getElementById("btn-pause").innerText = "PAUSAR";

        if (r.phase_end_at_ms) {
          const serverOffset = (r.server_now_ms || Date.now()) - Date.now();
          const currentEstimatedServerNow = Date.now() + serverOffset;
          timeLeft = Math.max(0, Math.ceil((r.phase_end_at_ms - currentEstimatedServerNow) / 1000));
        } else {
          timeLeft = r.remaining_seconds || 1500;
        }
      } else if (r.timer_state === 'paused') {
        isRunning = false;
        document.getElementById("btn-main").classList.add("hidden");
        document.getElementById("extra-controls").classList.remove("hidden");
        document.getElementById("btn-pause").innerText = "RETOMAR";
        timeLeft = r.remaining_seconds || 0;
      } else {
        // Idle
        isRunning = false;
        resetControlsUI();
        timeLeft = r.remaining_seconds || (isWorkPeriod ? workDurationInput * 60 : restDurationInput * 60);
      }

      totalTime = (isWorkPeriod ? workDurationInput : restDurationInput) * 60;
      updateDisplay();
    }
  } catch (err) {
    console.warn("Polling da sala:", err.message);
  }
}

async function leaveCurrentRoom() {
  if (!currentRoom) return;
  const roomId = currentRoom.id;

  try {
    await apiFetch('rooms.php?action=leave', {
      method: 'POST',
      body: { room_id: roomId }
    });
  } catch (err) {
    // Continua para fechar localmente
  }

  if (roomPollingInterval) {
    clearInterval(roomPollingInterval);
    roomPollingInterval = null;
  }
  currentRoom = null;

  const banner = document.getElementById("active-room-banner");
  if (banner) banner.classList.add("hidden");

  showNotification("Você saiu da sala de estudo.");
  // Restaura timer local
  resetControlsUI();
  isRunning = false;
  isWorkPeriod = true;
  totalTime = workDurationInput * 60;
  timeLeft = totalTime;
  updateDisplay();
}

// ==========================================================================
// PAINEL DO CRIADOR (ADMIN VIP)
// ==========================================================================
async function openAdminModal() {
  if (!currentUser || !currentUser.is_admin) {
    showNotification("Acesso restrito.");
    return;
  }
  document.getElementById("admin-modal").classList.remove("hidden");
  loadAdminVips();
}

async function loadAdminVips() {
  try {
    const res = await apiFetch('admin_vip.php?action=list');
    const ul = document.getElementById("admin-vips-list");
    if (!ul) return;
    ul.innerHTML = "";

    if (!res || !res.vips || res.vips.length === 0) {
      ul.innerHTML = '<li class="social-empty-msg">Nenhum VIP manual ativo no momento.</li>';
      return;
    }

    res.vips.forEach(v => {
      const li = document.createElement("li");
      li.className = "social-user-item";
      li.innerHTML = `
        <div class="social-user-meta">
          <div class="user-avatar-wrap">👑</div>
          <div class="social-user-info">
            <span class="social-user-name">${escapeHtml(v.display_name)} (@${escapeHtml(v.username)})</span>
            <span class="social-user-sub">${escapeHtml(v.email)} • ${escapeHtml(v.notes || 'Sem observação')}</span>
          </div>
        </div>
        <div class="social-actions">
          <button class="btn-sm btn-revoke-vip" data-uid="${v.id}">Revogar VIP</button>
        </div>
      `;

      li.querySelector(".btn-revoke-vip").addEventListener("click", () => revokeVip(v.id, v.display_name));
      ul.appendChild(li);
    });
  } catch (err) {
    console.warn("Erro ao listar VIPs:", err.message);
  }
}

let adminSearchDebounce = null;
function handleAdminSearch(e) {
  clearTimeout(adminSearchDebounce);
  const q = e.target.value.trim();
  if (q.length < 2) {
    document.getElementById("admin-search-results").innerHTML = "";
    return;
  }

  adminSearchDebounce = setTimeout(async () => {
    try {
      const res = await apiFetch(`admin_vip.php?action=search&q=${encodeURIComponent(q)}`);
      const ul = document.getElementById("admin-search-results");
      ul.innerHTML = "";

      if (!res || !res.users || res.users.length === 0) {
        ul.innerHTML = '<li class="social-empty-msg">Nenhum usuário encontrado.</li>';
        return;
      }

      res.users.forEach(u => {
        const li = document.createElement("li");
        li.className = "social-user-item";
        const isVip = u.plan_type === 'vip_manual';

        li.innerHTML = `
          <div class="social-user-meta">
            <div class="user-avatar-wrap">${isVip ? '👑' : '👤'}</div>
            <div class="social-user-info">
              <span class="social-user-name">${escapeHtml(u.display_name)} (@${escapeHtml(u.username)})</span>
              <span class="social-user-sub">${escapeHtml(u.email)} • Plano: ${u.plan_type}</span>
            </div>
          </div>
          <div class="social-actions">
            ${isVip
              ? `<button class="btn-sm btn-revoke-vip" data-uid="${u.id}">Revogar VIP</button>`
              : `<button class="btn-sm btn-grant-vip" data-uid="${u.id}">Conceder VIP</button>`
            }
          </div>
        `;

        const grantBtn = li.querySelector(".btn-grant-vip");
        if (grantBtn) grantBtn.addEventListener("click", () => grantVip(u.id, u.display_name));

        const revokeBtn = li.querySelector(".btn-revoke-vip");
        if (revokeBtn) revokeBtn.addEventListener("click", () => revokeVip(u.id, u.display_name));

        ul.appendChild(li);
      });
    } catch (err) {
      console.warn("Erro na busca administrativa:", err.message);
    }
  }, 300);
}

async function grantVip(userId, userName) {
  const notes = prompt(`Observação para o VIP de ${userName}:`, "Concedido pelo criador");
  if (notes === null) return;

  try {
    await apiFetch('admin_vip.php?action=grant', {
      method: 'POST',
      body: { user_id: userId, notes: notes }
    });
    showNotification(`VIP concedido com sucesso para ${userName}!`);
    loadAdminVips();
    document.getElementById("admin-search-results").innerHTML = "";
    document.getElementById("admin-search-input").value = "";
  } catch (err) {
    showNotification(err.message);
  }
}

async function revokeVip(userId, userName) {
  if (!confirm(`Deseja revogar o VIP de ${userName}?`)) return;

  try {
    await apiFetch('admin_vip.php?action=revoke', {
      method: 'POST',
      body: { user_id: userId }
    });
    showNotification(`VIP de ${userName} revogado com sucesso.`);
    loadAdminVips();
    document.getElementById("admin-search-results").innerHTML = "";
  } catch (err) {
    showNotification(err.message);
  }
}

// ==========================================================================
// CONTROLE DE MODAIS E GAVETAS (DRAWERS)
// ==========================================================================
function openAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.classList.remove("hidden");
  updateAuthUI();
  initGoogleSignIn();
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach(m => m.classList.add("hidden"));
  document.querySelectorAll(".config-sidebar").forEach(s => s.classList.remove("open"));
}

// Frases Motivacionais
function cycleQuote() {
  const textEl = document.getElementById("motivation-text");
  if (!textEl) return;
  textEl.classList.add("fade-out");
  setTimeout(() => {
    currentQuoteIndex = (currentQuoteIndex + 1) % motivationalQuotes.length;
    textEl.innerText = motivationalQuotes[currentQuoteIndex];
    textEl.classList.remove("fade-out");
  }, 1200);
}

// Lista oficial dos 8 temas suportados no CSS
const VALID_THEMES = [
  'midnight',
  'clean-white',
  'ocean-blue',
  'sunset-orange',
  'sakura-pink',
  'ruby-red',
  'forest-green',
  'purple-night'
];

// Personalização de Temas Centralizada e Segura
function applyTheme(themeName, persistLocally = true) {
  let chosenTheme = themeName;
  if (!chosenTheme || !VALID_THEMES.includes(chosenTheme)) {
    const local = localStorage.getItem("focus_theme");
    chosenTheme = (local && VALID_THEMES.includes(local)) ? local : 'clean-white';
  }

  // Remove qualquer classe de tema anterior e adiciona a nova
  VALID_THEMES.forEach(t => document.body.classList.remove(`theme-${t}`));
  document.body.classList.add(`theme-${chosenTheme}`);
  document.body.setAttribute("data-theme", chosenTheme);

  document.querySelectorAll(".theme-option").forEach((opt) => {
    opt.classList.remove("active");
    if (opt.getAttribute("data-theme") === chosenTheme) {
      opt.classList.add("active");
    }
  });

  if (persistLocally) {
    localStorage.setItem("focus_theme", chosenTheme);
    if (currentUser) {
      apiFetch('auth_login.php?action=update_profile', {
        method: 'POST',
        body: { theme: chosenTheme }
      }).catch(() => {});
    }
  }

  return chosenTheme;
}

// Alias seguro para compatibilidade
function setTheme(themeName, persistLocally = true) {
  return applyTheme(themeName, persistLocally);
}

// Sanitização HTML
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================================================
// INICIALIZAÇÃO DA APLICAÇÃO E EVENTOS
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Inicialização dos inputs de tempo
  workDurationInput = parseInt(document.getElementById("work-time-input").value) || 25;
  restDurationInput = parseInt(document.getElementById("rest-time-input").value) || 5;
  totalTime = workDurationInput * 60;
  timeLeft = totalTime;
  updateDisplay();

  const motEl = document.getElementById("motivation-text");
  if (motEl) motEl.innerText = motivationalQuotes[0];

  const activeTheme = localStorage.getItem("focus_theme") || "clean-white";
  applyTheme(activeTheme, false);

  // Inicializa autenticação silenciosa
  checkAuthStatus();

  // --- Botões do Timer ---
  document.getElementById("btn-main").addEventListener("click", async function () {
    initAudio();
    if (currentRoom && currentRoom.mode === 'synced') {
      try {
        const res = await apiFetch('rooms.php?action=start', {
          method: 'POST',
          body: { room_id: currentRoom.id }
        });
        if (res && res.room) connectToRoom(res.room);
      } catch (err) {
        showNotification(err.message);
      }
      return;
    }

    if (!isRunning) {
      isRunning = true;
      expectedEndTime = Date.now() + (timeLeft * 1000);
      this.classList.add("hidden");
      document.getElementById("extra-controls").classList.remove("hidden");
      document.getElementById("btn-pause").innerText = "PAUSAR";
      timerId = setInterval(handleTick, 500);
      sendHeartbeat();
    }
  });

  document.getElementById("btn-pause").addEventListener("click", async function () {
    if (currentRoom && currentRoom.mode === 'synced') {
      const action = isRunning ? 'pause' : 'resume';
      try {
        const res = await apiFetch(`rooms.php?action=${action}`, {
          method: 'POST',
          body: { room_id: currentRoom.id }
        });
        if (res && res.room) connectToRoom(res.room);
      } catch (err) {
        showNotification(err.message);
      }
      return;
    }

    if (isRunning) {
      clearInterval(timerId);
      timerId = null;
      isRunning = false;
      this.innerText = "RETOMAR";
    } else {
      isRunning = true;
      expectedEndTime = Date.now() + (timeLeft * 1000);
      this.innerText = "PAUSAR";
      timerId = setInterval(handleTick, 500);
    }
    sendHeartbeat();
  });

  document.getElementById("btn-reset").addEventListener("click", async () => {
    if (currentRoom && currentRoom.mode === 'synced') {
      try {
        const res = await apiFetch('rooms.php?action=reset', {
          method: 'POST',
          body: { room_id: currentRoom.id }
        });
        if (res && res.room) connectToRoom(res.room);
      } catch (err) {
        showNotification(err.message);
      }
      return;
    }

    clearInterval(timerId);
    timerId = null;
    isRunning = false;
    timeLeft = totalTime;
    updateDisplay();
    document.getElementById("btn-pause").innerText = "PAUSAR";
    sendHeartbeat();
  });

  document.getElementById("btn-stop").addEventListener("click", () => {
    clearInterval(timerId);
    timerId = null;
    isRunning = false;
    isWorkPeriod = true;
    document.getElementById("timer-status").innerText = "TRABALHO";
    totalTime = workDurationInput * 60;
    timeLeft = totalTime;
    updateDisplay();
    resetControlsUI();
    sendHeartbeat();
  });

  // --- Ajustes de Tempo de Foco e Descanso ---
  function updateInputsLogic(inputId, isWork) {
    let val = parseInt(document.getElementById(inputId).value);
    if (isWork) {
      workDurationInput = val;
      if (!isRunning && isWorkPeriod) {
        totalTime = workDurationInput * 60;
        timeLeft = totalTime;
        updateDisplay();
      }
    } else {
      restDurationInput = val;
      if (!isRunning && !isWorkPeriod) {
        totalTime = restDurationInput * 60;
        timeLeft = totalTime;
        updateDisplay();
      }
    }
  }

  document.getElementById("work-time-input").addEventListener("change", function () {
    let val = parseInt(this.value);
    if (isNaN(val) || val < 1) this.value = 25;
    updateInputsLogic("work-time-input", true);
  });

  document.getElementById("rest-time-input").addEventListener("change", function () {
    let val = parseInt(this.value);
    if (isNaN(val) || val < 1) this.value = 5;
    updateInputsLogic("rest-time-input", false);
  });

  if (document.getElementById("work-minus")) {
    document.getElementById("work-minus").addEventListener("click", () => {
      const input = document.getElementById("work-time-input");
      if (input.value > 1) { input.value = parseInt(input.value) - 1; updateInputsLogic("work-time-input", true); }
    });
    document.getElementById("work-plus").addEventListener("click", () => {
      const input = document.getElementById("work-time-input");
      if (input.value < 480) { input.value = parseInt(input.value) + 1; updateInputsLogic("work-time-input", true); }
    });
    document.getElementById("rest-minus").addEventListener("click", () => {
      const input = document.getElementById("rest-time-input");
      if (input.value > 1) { input.value = parseInt(input.value) - 1; updateInputsLogic("rest-time-input", false); }
    });
    document.getElementById("rest-plus").addEventListener("click", () => {
      const input = document.getElementById("rest-time-input");
      if (input.value < 120) { input.value = parseInt(input.value) + 1; updateInputsLogic("rest-time-input", false); }
    });
  }

  // --- Barra Lateral de Missões ---
  const sidebarToggle = document.getElementById("sidebar-toggle");
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      const sidebar = document.querySelector(".todo-sidebar");
      if (sidebar) {
        sidebar.style.display = (sidebar.style.display === "none") ? "flex" : "none";
      }
    });
  }

  // Input de Nova Tarefa
  document.getElementById("todo-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addTodo(e.target.value);
      e.target.value = "";
    }
  });

  // --- Eventos de Abertura de Drawers e Modais da Top-Bar ---
  document.getElementById("menu-toggle").addEventListener("click", () => {
    document.getElementById("config-sidebar").classList.toggle("open");
  });
  document.getElementById("config-close").addEventListener("click", () => {
    document.getElementById("config-sidebar").classList.remove("open");
  });

  document.getElementById("friends-btn").addEventListener("click", openFriendsDrawer);
  document.getElementById("friends-close").addEventListener("click", () => {
    document.getElementById("friends-sidebar").classList.remove("open");
  });

  document.getElementById("rooms-btn").addEventListener("click", openRoomsModal);
  document.getElementById("rooms-modal-close").addEventListener("click", () => {
    document.getElementById("rooms-modal").classList.add("hidden");
  });

  document.getElementById("admin-btn").addEventListener("click", openAdminModal);
  document.getElementById("admin-modal-close").addEventListener("click", () => {
    document.getElementById("admin-modal").classList.add("hidden");
  });

  document.getElementById("auth-btn").addEventListener("click", openAuthModal);
  document.getElementById("auth-modal-close").addEventListener("click", () => {
    document.getElementById("auth-modal").classList.add("hidden");
  });

  document.getElementById("btn-claim-freeze").addEventListener("click", claimFreezeReveal);

  // Sair da Sala Ativa
  document.getElementById("btn-leave-room").addEventListener("click", leaveCurrentRoom);

  // Seletores de Tema
  document.querySelectorAll(".theme-option").forEach((option) => {
    option.addEventListener("click", function () {
      const theme = this.getAttribute("data-theme");
      setTheme(theme, true);
    });
  });

  // --- Abas do Drawer Social ---
  document.querySelectorAll(".social-tab-btn").forEach(btn => {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".social-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".social-tab-content").forEach(c => c.classList.remove("active"));
      this.classList.add("active");
      const targetTab = this.getAttribute("data-tab");
      const targetEl = document.getElementById(targetTab);
      if (targetEl) targetEl.classList.add("active");

      if (targetTab === 'tab-friends-list') loadFriendsList();
      if (targetTab === 'tab-friends-requests') loadFriendRequests();
    });
  });

  document.getElementById("friend-search-input").addEventListener("input", handleFriendSearch);

  // --- Abas do Modal de Autenticação (Visitante) ---
  const tabLogin = document.getElementById("tab-btn-login");
  const tabRegister = document.getElementById("tab-btn-register");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");

  if (tabLogin && tabRegister) {
    tabLogin.addEventListener("click", () => {
      tabLogin.classList.add("active");
      tabRegister.classList.remove("active");
      loginForm.classList.remove("hidden");
      registerForm.classList.add("hidden");
      document.getElementById("auth-modal-title").innerText = "Entrar na sua Conta";
    });
    tabRegister.addEventListener("click", () => {
      tabRegister.classList.add("active");
      tabLogin.classList.remove("active");
      loginForm.classList.add("hidden");
      registerForm.classList.remove("hidden");
      document.getElementById("auth-modal-title").innerText = "Criar Nova Conta";
    });
  }

  // Submissão de Formulários de Auth e Perfil
  if (loginForm) loginForm.addEventListener("submit", handleLogin);
  if (registerForm) registerForm.addEventListener("submit", handleRegister);
  const profileForm = document.getElementById("profile-form");
  if (profileForm) profileForm.addEventListener("submit", handleUpdateProfile);
  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  // Submissão de Criação de Sala
  const createRoomForm = document.getElementById("create-room-form");
  if (createRoomForm) createRoomForm.addEventListener("submit", handleCreateRoom);

  // Busca Administrativa
  const adminSearchInput = document.getElementById("admin-search-input");
  if (adminSearchInput) adminSearchInput.addEventListener("input", handleAdminSearch);

  // Fechar modais ao clicar no fundo escuro
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.classList.add("hidden");
      }
    });
  });

  // Clique no Badge de Ofensiva
  const streakBadge = document.getElementById("streak-badge");
  if (streakBadge) {
    streakBadge.addEventListener("click", () => {
      if (currentUser) {
        openAuthModal();
      } else {
        openAuthModal();
        showNotification("Faça login para salvar seus dias de ofensiva na nuvem! 🔥");
      }
    });
  }

  // Ciclo de frases a cada 10 min
  setInterval(cycleQuote, 10 * 60 * 1000);
});
