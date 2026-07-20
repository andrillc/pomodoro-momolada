// --- Estado da Aplicação e Sincronização LocalStorage ---
let isRunning = false;
let isWorkPeriod = true;
let totalTime = 1500; 
let timeLeft = 1500;
let timerId = null;

let workDurationInput = 25;
let restDurationInput = 5;

// Instanciação da Web Audio API Context
let audioCtx = null;

// Suite de Frases de Alta Qualidade
const motivationalQuotes = [
    "Grandes feitos são compostos por uma sequência de pequenos passos bem dados.",
    "O foco não é a ausência de distrações, mas a presença de um propósito claro.",
    "A simplicidade e a constância produzem resultados extraordinários.",
    "Proteja o seu tempo de atenção como seu recurso mais precioso.",
    "Continue. O progresso invisível é o que constrói o sucesso visível.",
    "Uma tarefa de cada vez. Uma respiração de cada vez. Presença total.",
    "O minimalismo mental abre espaço para a criatividade fluir livremente."
];
let currentQuoteIndex = 0;

// Estado das Tarefas Iniciadas do Usuário (Texto padrão ajustado conforme solicitado)
let todos = JSON.parse(localStorage.getItem('focus_todos')) || [
    { id: '1', text: 'Aqui você pode definir uma tarefa e organizar por prioridade movendo elas', completed: false, priority: 'high' }
];

// --- Sintetizador Customizado Web Audio API (Sons Premium) ---
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

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800 + (intensity * 140), audioCtx.currentTime); 

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
    const chords = isWorkDone ? [523.25, 659.25, 783.99, 1046.50] : [440.00, 554.37, 659.25, 880.00];

    chords.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + (idx * 0.07));

        gainNode.gain.setValueAtTime(0.01, now + (idx * 0.07));
        gainNode.gain.linearRampToValueAtTime(0.12, now + (idx * 0.07) + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + (idx * 0.07) + 0.35);

        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.start(now + (idx * 0.07));
        osc.stop(now + (idx * 0.07) + 0.4);
    });
}

// --- Controle do Progresso Circular SVG ---
const circle = document.querySelector('.progress-ring__circle');
const radius = circle.r.baseVal.value;
const circumference = radius * 2 * Math.PI;

circle.style.strokeDasharray = `${circumference} ${circumference}`;
circle.style.strokeDashoffset = 0;

function setProgress(percent) {
    const offset = circumference - (percent / 100) * circumference;
    circle.style.strokeDashoffset = offset;
}

// --- Notificações Toast do Sistema ---
function showNotification(message) {
    const banner = document.getElementById('notification');
    banner.innerText = message;
    banner.classList.add('show');
    setTimeout(() => {
        banner.classList.remove('show');
    }, 4000);
}

// --- Lógica Principal do Timer ---
function updateDisplay() {
    const hours = Math.floor(timeLeft / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);
    const seconds = timeLeft % 60;

    const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    document.getElementById('timer-countdown').innerText = formattedTime;

    const percent = (timeLeft / totalTime) * 100;
    setProgress(percent);

    const container = document.getElementById('timer-container');
    container.classList.remove('state-glow', 'state-pulse');

    if (isRunning && isWorkPeriod) {
        if (timeLeft <= 3 && timeLeft > 0) {
            container.classList.add('state-pulse', 'state-glow');
        } else if (timeLeft <= 10 && timeLeft > 0) {
            container.classList.add('state-glow');
        }
    }
}

function handleTick() {
    if (timeLeft > 0) {
        timeLeft--;

        if (isWorkPeriod && timeLeft <= 3 && timeLeft >= 1) {
            const intensity = 4 - timeLeft; 
            playTick(intensity);
        }

        updateDisplay();
    } else {
        clearInterval(timerId);
        timerId = null;
        isRunning = false;

        if (isWorkPeriod) {
            playCompletionChime(true);
            showNotification("Sessão de foco concluída! Descanse um pouco.");
            isWorkPeriod = false;
            document.getElementById('timer-status').innerText = "DESCANSO";
            totalTime = restDurationInput * 60;
        } else {
            playCompletionChime(false);
            showNotification("Descanso finalizado! Pronto para focar?");
            isWorkPeriod = true;
            document.getElementById('timer-status').innerText = "TRABALHO";
            totalTime = workDurationInput * 60;
        }

        const container = document.getElementById('timer-container');
        container.style.transform = 'scale(0.96)';
        setTimeout(() => {
            container.style.transform = 'scale(1)';
        }, 300);

        timeLeft = totalTime;
        updateDisplay();
        resetControlsUI();
    }
}

function resetControlsUI() {
    document.getElementById('btn-main').innerText = "INICIAR";
    document.getElementById('btn-main').classList.remove('hidden');
    document.getElementById('extra-controls').classList.add('hidden');
}

// --- Transição Suave de Frases Motivacionais ---
function cycleQuote() {
    const textEl = document.getElementById('motivation-text');
    textEl.classList.add('fade-out');
    setTimeout(() => {
        currentQuoteIndex = (currentQuoteIndex + 1) % motivationalQuotes.length;
        textEl.innerText = motivationalQuotes[currentQuoteIndex];
        textEl.classList.remove('fade-out');
    }, 1200);
}

// --- Renderização e Ciclo das Tarefas ---
function renderTodos() {
    const listContainer = document.getElementById('todo-list');
    listContainer.innerHTML = '';

    todos.forEach((todo) => {
        const li = document.createElement('li');
        li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
        li.setAttribute('draggable', true);
        li.setAttribute('data-id', todo.id);

        li.innerHTML = `
            <span class="priority-dot p-${todo.priority || 'medium'}" title="Clique para mudar a prioridade"></span>
            <div class="checkbox-custom"></div>
            <div class="todo-text" contenteditable="true">${todo.text}</div>
            <button class="todo-delete-btn">&times;</button>
        `;

        li.querySelector('.checkbox-custom').addEventListener('click', () => toggleTodo(todo.id));
        li.querySelector('.priority-dot').addEventListener('click', () => cyclePriority(todo.id));
        
        const textEl = li.querySelector('.todo-text');
        textEl.addEventListener('blur', () => {
            todo.text = textEl.innerText.trim();
            saveTodos();
        });

        li.querySelector('.todo-delete-btn').addEventListener('click', () => deleteTodo(todo.id));

        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragend', handleDragEnd);

        listContainer.appendChild(li);
    });
}

function saveTodos() {
    localStorage.setItem('focus_todos', JSON.stringify(todos));
}

// Força a limpeza de resíduos de cache antigos para garantir a nova frase padrão de tarefas
if (todos.length === 1 && todos[0].text.includes("Otimizar sintetizador")) {
    todos = [{ id: '1', text: 'Aqui você pode definir uma tarefa e organizar por prioridade movendo elas', completed: false, priority: 'high' }];
    saveTodos();
}

function addTodo(text) {
    if (!text.trim()) return;
    const newTodo = {
        id: Date.now().toString(),
        text: text,
        completed: false,
        priority: 'medium'
    };
    todos.push(newTodo);
    saveTodos();
    renderTodos();
}

function toggleTodo(id) {
    todos = todos.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
    saveTodos();
    renderTodos();
}

function cyclePriority(id) {
    const pLevels = ['low', 'medium', 'high'];
    todos = todos.map(t => {
        if (t.id === id) {
            let nextIdx = (pLevels.indexOf(t.priority || 'medium') + 1) % pLevels.length;
            return { ...t, priority: pLevels[nextIdx] };
        }
        return t;
    });
    saveTodos();
    renderTodos();
}

function deleteTodo(id) {
    todos = todos.filter(t => t.id !== id);
    saveTodos();
    renderTodos();
}

// --- Eventos de Arrastar (Drag & Drop) ---
let dragSourceElement = null;

function handleDragStart(e) {
    dragSourceElement = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.getAttribute('data-id'));
}

function handleDragOver(e) {
    e.preventDefault();
    return false;
}

function handleDrop(e) {
    e.stopPropagation();
    e.preventDefault();
    const targetId = this.getAttribute('data-id');
    const sourceId = e.dataTransfer.getData('text/plain');

    if (sourceId !== targetId) {
        const sourceIdx = todos.findIndex(t => t.id === sourceId);
        const targetIdx = todos.findIndex(t => t.id === targetId);
        
        const [movedItem] = todos.splice(sourceIdx, 1);
        todos.splice(targetIdx, 0, movedItem);
        
        saveTodos();
        renderTodos();
    }
}

function handleDragEnd() {
    this.classList.remove('dragging');
}

// --- Inicialização do App e Escuta de Eventos ---
document.addEventListener('DOMContentLoaded', () => {
    workDurationInput = parseInt(document.getElementById('work-time-input').value) || 25;
    restDurationInput = parseInt(document.getElementById('rest-time-input').value) || 5;
    totalTime = workDurationInput * 60;
    timeLeft = totalTime;
    updateDisplay();

    document.getElementById('motivation-text').innerText = motivationalQuotes[0];

    const activeTheme = localStorage.getItem('focus_theme') || 'midnight';
    setTheme(activeTheme);

    document.getElementById('btn-main').addEventListener('click', function() {
        initAudio();
        if (!isRunning) {
            isRunning = true;
            this.classList.add('hidden');
            document.getElementById('extra-controls').classList.remove('hidden');
            document.getElementById('btn-pause').innerText = "PAUSAR";
            timerId = setInterval(handleTick, 1000);
        }
    });

    document.getElementById('btn-pause').addEventListener('click', function() {
        if (isRunning) {
            clearInterval(timerId);
            timerId = null;
            isRunning = false;
            this.innerText = "RETOMAR";
        } else {
            isRunning = true;
            this.innerText = "PAUSAR";
            timerId = setInterval(handleTick, 1000);
        }
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
        clearInterval(timerId);
        timerId = null;
        isRunning = false;
        timeLeft = totalTime;
        updateDisplay();
        document.getElementById('btn-pause').innerText = "PAUSAR";
    });

    document.getElementById('btn-stop').addEventListener('click', () => {
        clearInterval(timerId);
        timerId = null;
        isRunning = false;
        isWorkPeriod = true;
        document.getElementById('timer-status').innerText = "TRABALHO";
        totalTime = workDurationInput * 60;
        timeLeft = totalTime;
        updateDisplay();
        resetControlsUI();
    });

    document.getElementById('work-time-input').addEventListener('change', function() {
        let val = parseInt(this.value);
        if (isNaN(val) || val < 1) val = 25;
        workDurationInput = val;
        if (!isRunning && isWorkPeriod) {
            totalTime = workDurationInput * 60;
            timeLeft = totalTime;
            updateDisplay();
        }
    });

    document.getElementById('rest-time-input').addEventListener('change', function() {
        let val = parseInt(this.value);
        if (isNaN(val) || val < 1) val = 5;
        restDurationInput = val;
        if (!isRunning && !isWorkPeriod) {
            totalTime = restDurationInput * 60;
            timeLeft = totalTime;
            updateDisplay();
        }
    });

    document.getElementById('todo-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            addTodo(e.target.value);
            e.target.value = '';
        }
    });

    document.getElementById('menu-toggle').addEventListener('click', () => {
        document.getElementById('config-sidebar').classList.toggle('open');
    });

    document.getElementById('config-close').addEventListener('click', () => {
        document.getElementById('config-sidebar').classList.remove('open');
    });

    document.querySelectorAll('.theme-option').forEach(option => {
        option.addEventListener('click', function() {
            const theme = this.getAttribute('data-theme');
            setTheme(theme);
        });
    });

    setInterval(cycleQuote, 10 * 60 * 1000);
    renderTodos();
});

function setTheme(themeName) {
    document.body.className = '';
    document.body.classList.add(`theme-${themeName}`);

    document.querySelectorAll('.theme-option').forEach(opt => {
        opt.classList.remove('active');
        if (opt.getAttribute('data-theme') === themeName) {
            opt.classList.add('active');
        }
    });

    localStorage.setItem('focus_theme', themeName);
}